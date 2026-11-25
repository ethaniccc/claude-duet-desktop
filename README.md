# Claude Duet Desktop

A desktop app for [Claude Duet](https://claude.com/duet). It shows `claude.ai/duet` in its own window.

## Run the app

You must have Node.js 22.12 or later.

```sh
npm install
npm start
```

The first start can take a minute, because Electron downloads its files.

Sign in to claude.ai in the window. The app keeps you signed in when you close it.

Sign in with the code in the sign-in email, or with Apple. Google and SSO do not work in the app: they open your default browser. Do not click the link in the sign-in email, because it also opens your default browser.

## What the app permits

- Pages on `claude.ai` and the Apple sign-in pages open in the app window.
- Other `http`, `https` and `mailto` links open in your default browser. This includes links on `claude.ai` that redirect to a different site.
- Only `claude.ai` can show notifications, use the microphone, and write to the clipboard. The app refuses the camera and screen capture.
- If the page cannot load, for example when you are offline, the app tries again every 5 seconds.
