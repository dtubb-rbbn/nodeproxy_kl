# nodeproxy_kl
Proxies REST requests from SDK to server with mapping of Google sign-in token to internal username and password.

# Configuration
Create a configuration file called "nodeproxy-kl.config.json" in the directory where you are running this.  It should look something like this...
```
{
	"local":{
		"daemon":false,
		"host":"localhost",
		"port":8001,
		"google": {
			"client_id":"a_google_project_client_id"
		}
	},
	"remote":{
		"host":"a_rest_server_hostname",
		"port":443,
		"protocol":"https"
	},
	"aaa":{
		"a_google_identity_sub":{"insideUsername":"a_username@some_domain","insidePassword":"a_secret_password"}
	}
}
```

The file specifies the REST server address.  This proxy only supports certain REST URL patterns (there is a validator in the code).

When a request is recevied at the proxy (e.g. http://localhost:8001), the Authorization (Basic) header is decoded and the password-part is obtained.  This should contain an id_token from Google (see below).  The token is validated against the google project "client_id" specified in the configuration file.

If the token is valid the user id (sub) from the token is used to index the "aaa" section of the configuration file and the "inside" username and password is obtained.  The REST request is then proxied to the server address specified in the "remote" section of the configuration file with the "inside" username and password encoded in Authorization (Basic) header.

# Running the application
```
node 
```

# Invoking this from a web page
Take your favourite SDK sample and cut out the call to "connect" to the server:
```
	my_sdk.connect({
		username: username,
		password: password
	});

```

Add these Google linkages, edited with the appropriate Google project client_id in the "content" of the META tag:
```
<script src="https://apis.google.com/js/platform.js" async defer></script>
<meta name="google-signin-client_id" content="a_google_project_client_id">
```

Put a Google sign-in button on the page:
```
<div class="g-signin2" data-onsuccess="onSignIn"></div>
```

Then add some code to handle the sign-in completion and to start-up the SDK:
```
function onSignIn(googleUser) {
  var profile = googleUser.getBasicProfile();
  console.log('ID: ' + profile.getId()); 
  console.log('Name: ' + profile.getName());
  
	// Authenticate, and connect, the user with Kandy.
	password=googleUser.getAuthResponse().id_token;
	my_sdk.connect({
		username: "google_sign_in",
		password: password
	});
}
```

When you run the application, the user can sign-in and the back-end is passed a tokenised identifier for the Google-authenticated user.

# Hosting the client side
The client must be running somewhere that Google will be happy with (not AWS auto-generated hosts?).  For testing, simple npm webserver works well - this will serve the current directory on http://localhost:8000:
```
npm install -g local-web-server
ws
```

Running on localhost allows WebRTC applications to function.

# Setting up Google project
Create a google project and add the "local" web server address as an "authorized JavaScript origin", e.g. http://localhost:8000.

Copy the client_id from the project into the configuration file and the META tag in the client-side web page.

# Dependencies
```
npm install http-proxy --save
npm install googleapis
```

# Work in progress
Token lifecycle is not managed.


