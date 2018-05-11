var http = require('http'),
    https = require('https'),
    httpProxy = require('http-proxy'),
    queryString=require('querystring'),
	{OAuth2Client}=require('google-auth-library');

//
// read config data from json config file
//
var configFilename="./nodeproxy-kl.config.json";
if(process.argv.length>2) {
	configFilename=process.argv[2];
	console.log("Attempting to load user specified configuration file: "+configFilename);
} else {
	console.log("Attempting to load default configuraiton file: "+configFilename);
}
var configData=require(configFilename);


//
// run as daemon if enabled in config
//
if(configData.local.daemon) {
	console.log("Spawning daemon process");
	require('daemon')();
}

///////////////////////////////////////////////////////////////
// configuration
//
// target system
//
if(null==remoteRestHost) {
	console.log("No redirect for REST requests");
} else {
	console.log("Redirect for REST requests to "+remoteRestUrl);
}


///////////////////////////////////////////////////////////////
//
// launch the rest-proxy server
//
var aaaProxyServerAddress=configData.local.host||"localhost";
var aaaProxyServerPort=configData.local.port;
var aaaProxyServerUrl="http://"+aaaProxyServerAddress+":"+aaaProxyServerPort;

var remoteRestHost=configData.remote.host;
var remoteRestPort=configData.remote.port;
var remoteRestProtocol=configData.remote.protocol||"http";
var remoteRestUrl=remoteRestProtocol+"://"+remoteRestHost+":"+remoteRestPort;

var proxyTarget={};
proxyTarget.rest={host:remoteRestHost,port:remoteRestPort,protocol:remoteRestProtocol};

const gooogleOAuth2Client=new OAuth2Client(configData.local.google.client);


http.createServer(function (req, res) {
	new _RestProxyTransaction(req,res,configData.aaa,proxyTarget);  
}).listen(aaaProxyServerPort,aaaProxyServerAddress);

console.log("[   REST_PROXY   ] --- Running at "+aaaProxyServerUrl+" to "+JSON.stringify(proxyTarget));
//
/////////////////////////////////////////////////////////////



///////////////////////////////////////////////////////////////
//
// a "transaction" object to handle proxy function for each transaction
//
function _RestProxyTransaction(req,res,aaaDatabase,targetConfigurations) {

	this.url=req.url;
	this.requestBody="";
	this.req=req;
	this.res=res;
	this.targetConfigurations=targetConfigurations;
	this.transactionTarget={};
	this.aaaDatabase=aaaDatabase;
	this.restUrlPrefix="/rest/version/1/";
	this.restRequestSourceUser=null; // the username specified in the REST resource URL
	this.serviceUrl=null; // the service specified in the REST resource URL, with any trailing suffixes
	this.restUrlSuffix=null; // the trailling REST URL suffix 
	this.outsideUsername=null; // the username provided in HTTP Authorization header
	this.outsidePassword=null; // the password provided in HTTP Authorization header
	this.insideUsername=null; // the username that will be used in requests towards the rest server
	this.insidePassword=null; // the password that will be used in requests towards the rest server
	this.restRequestDestination=null; // the URL to which the request will be proxied
	this.proxyResponseData=""; // data received from the target 
	this.proxyResponse=null; // response object from the target
	this.req.on('data',this.onRequestData.bind(this));
	this.req.on('end',this.onRequestEnd.bind(this));			
	this.req.on('error',this.onRequestError.bind(this));

};

//
// function to handle data received on the request (e.g. POST)
// store data in local variable
//
_RestProxyTransaction.prototype.onRequestData=function(chunk) {
	this.requestBody+=chunk;
};


//
//function to handle the end of data being transmitted from the client
//we can now make the request to the target
//
_RestProxyTransaction.prototype.onRequestEnd=function() {

	// parse the URL to understand user versus anonymous etc.
	if(!this.parseUrl()) {
	    console.log("[   REST_PROXY   ] !!! URL parsing failed: "+this.url);
	    this.res.writeHead(404, {'Content-Type': 'plain/text'});
	    this.res.end("URL parsing failed: "+this.url);

	// handle CORS
	} else if(this.req.method=="OPTIONS") {
		
	    // should have some checking of request headers in here (same goes for onResponseEndProxyUserRequest)
	    console.log("[   REST_PROXY   ] <<< Responding 200 OK to OPTIONS");
	    console.log("[   REST_PROXY   ] "+this.req.headers);
	    this.res.setHeader("Access-Control-Allow-Credentials",true);
	    this.res.setHeader("Access-Control-Allow-Headers",this.req.headers['access-control-request-headers']);
	    this.res.setHeader("Access-Control-Allow-Methods",this.req.headers['access-control-request-method']);
	    this.res.setHeader("Access-Control-Allow-Origin",this.req.headers['origin']);
	    this.res.writeHead(200);
	    this.res.end();
		
	} else {

		// parse HTTP authorization header if there is one
		this.parseHttpAuthorizationHeader();
	}
};



//
//error handler
//
_RestProxyTransaction.prototype.onRequestError=function(e) {
console.log("[   REST_PROXY   ] !!! Request Error: "+e.message);
};	  


//
//function to handle the end of data being received from the target
//write the data back in response to the original request
//
_RestProxyTransaction.prototype.onResponseEndProxyUserRequest=function() {
	console.log("[   REST_PROXY   ] <<< Response completed: "+this.proxyResponse.statusCode);
		
	var responseData=this.proxyResponseData;
	
	// complete the client response now that the proxy response has been received
	// could do more work to make this transparent...
	console.log("[   REST_PROXY   ] <<< Writing response back to client");
        this.res.setHeader("Access-Control-Allow-Credentials",true);
        this.res.setHeader("Access-Control-Allow-Origin",this.req.headers['origin']);	
	this.res.writeHead(this.proxyResponse.statusCode, {'content-type': 'application/json','content-length':responseData.length});
	this.res.end(responseData);
};


//
// utility function to parse the URL 
//
_RestProxyTransaction.prototype.parseUrl=function() {
	var parsingSuccess=false;
	
	// check for URL with user or anonymous REST request
	// try first to match with suffix, then without suffix
	var urlWithoutSuffixRegExpString="^"+this.restUrlPrefix+"([^\/]*)\/([^\/]*)\/([^\/]*)";
	var urlWithSuffixRegExpString=urlWithoutSuffixRegExpString+"\/(.*)";
	reqUrlParse=RegExp(urlWithSuffixRegExpString,"i").exec(this.req.url);
	if(reqUrlParse==null) {
		reqUrlParse=RegExp(urlWithoutSuffixRegExpString,"i").exec(this.req.url);
	}
	if(reqUrlParse!=null) {
	    if(reqUrlParse.length>3) {
			this.restRequestSourceUser=reqUrlParse[2];
			this.serviceUrl=reqUrlParse[3].split("?")[0]; // remove trailing query strings
	    	if(reqUrlParse[1].toLowerCase()=="user") {
	    		this.transactionTarget=this.targetConfigurations.rest;
			    parsingSuccess=true;
			}
	    }
		if(reqUrlParse.length>4) {
			this.restUrlSuffix=reqUrlParse[4];	    		
		}
	} 
    console.log("[   REST_PROXY   ] >>> "+this.restRequestSourceUser+" "+this.serviceUrl);
	
	return parsingSuccess;
};



//
// utility function to parse the HTTP Authorization header
//
_RestProxyTransaction.prototype.parseHttpAuthorizationHeader=async function(aaaDatabase,success_callback,failure_callback) {
    var authHeader=this.req.headers['authorization']||'';    // get the header
    console.log("[   REST_PROXY   ] >>> Parsing auth header: "+authHeader);    
 
    var authToken=authHeader.split(/\s+/).pop()||'';            // and the encoded auth token
    var authString=new Buffer(authToken, 'base64').toString();    // convert from base64
    var authUsernamePasswordParts=authString.split(/:/);            // split on colon
    this.outsideUsername=authUsernamePasswordParts[0]||'';
    this.outsidePassword=authUsernamePasswordParts[1]||'';
    console.log("[   REST_PROXY   ] >>> Outside credentials are "+this.outsideUsername+"/"+this.outsidePassword);    
    
	token=await gooogleOAuth2Client.verifyIdToken({idToken:this.outsidePassword,audience:configData.local.google.client});
	this.outsideUsername=token.getPayload().sub;
	console.log("[   REST_PROXY   ] >>> Outside credentials decode to id "+this.outsideUsername);    
	if(this.aaaDatabase[this.outsideUsername]) {
		this.insideUsername=this.aaaDatabase[this.outsideUsername].insideUsername;
		this.insidePassword=this.aaaDatabase[this.outsideUsername].insidePassword;    		
		console.log("[   REST_PROXY   ] >>> Inside credentials are "+this.insideUsername+"/"+this.insidePassword);

		console.log("[   REST_PROXY   ] >>> "+this.requestBody); 
		console.log("[   REST_PROXY   ] >>> Mapping URL: "+this.restUrlPrefix+","+this.serviceUrl+","+this.restUrlSuffix);
		this.restRequestDestination=this.restUrlPrefix+"user/"+this.insideUsername+"/"+this.serviceUrl;
		if(this.restUrlSuffix!=null) {
			this.restRequestDestination+="/"+this.restUrlSuffix;
		}
		console.log("[   REST_PROXY   ] <<< REST mapped URL from "+this.req.url+" to "+this.restRequestDestination);
		// proxy the request
		this.proxyRequest(this.buildHttpRequestOptions(),(this.onResponseEndProxyUserRequest).bind(this));
		
	} else {
		console.log("[   REST_PROXY   ] !!! Outside username does not match AAA, continuing with outside credentials");
		this.insideUsername=this.aaaDatabase[this.outsideUsername].outsideUsername;
		this.insidePassword=this.aaaDatabase[this.outsideUsername].outsidePassword;    		
	};
};


//
//utility function to build new HTTP request options
//
_RestProxyTransaction.prototype.buildHttpRequestOptions=function() {
    var options={};
    options.hostname=this.transactionTarget.host;
    options.port=this.transactionTarget.port;
    options.path=this.restRequestDestination;
    options.method=this.req.method;
    options.rejectUnauthorized=false;
    options.headers={};// this.req.headers;
    //delete options.headers["content-length"];
    
    options.headers["content-type"]="application/json";
    options.headers["accept"]="application/json";
    options.headers["connection"]="keep-alive";
    options.headers["content-length"]=this.requestBody.length;
    	
	if((this.insideUsername!=null)&&(this.insidePassword!=null)) {
		if(true) {
			// create a new Authorization header with some new credentials
			var proxyRequestAuth=new Buffer(this.insideUsername+":"+this.insidePassword).toString('base64');
			options.headers["authorization"]='Basic '+proxyRequestAuth;
		} else {
			options.headers["x-user"]=this.insideUsername;
			options.headers["x-password"]=this.insidePassword;
		}
	}
    return options;
};


//
// function to perform a new REST query to REST-server and pass the response 
// back to the original request's response object
//
_RestProxyTransaction.prototype.proxyRequest=function(options,responseEndHandler) {
	
    // proxy this modified request using new HTTP request
    console.log("[   REST_PROXY   ] <<< REST transaction target is "+JSON.stringify(this.transactionTarget));  
    console.log("[   REST_PROXY   ] <<< REST making request "+JSON.stringify(options,null,4));  

    // choose http or https
    var requestor=http;
    if("https"==this.transactionTarget.protocol.toLowerCase()) {
    	requestor=https;
    }
    
    // build the request object with "data" and "end" handler functions
    var proxyRequest=requestor.request(options,(function(proxyResponse) {
    	this.proxyResponse=proxyResponse;
    	
	    // data being received from REST-server store in local variable
		proxyResponse.on('data',(function(d) {
			console.log("[   REST_PROXY   ] <<< Receiving REST response data from "+this.restRequestDestination);
			this.proxyResponseData+=d;
		}).bind(this));
		
		// call the relevant handler function when the data has all been read 
		proxyResponse.on('end',responseEndHandler);
		
		// error handler
	    proxyResponse.on('error', (function(e) {
		    console.log("[   REST_PROXY   ] !!! Proxy Request Error: "+e.message);
	    }).bind(this));	  
    }).bind(this)); 
    
    // fire the request to REST-server
    proxyRequest.write(this.requestBody);
    proxyRequest.end();	
};
