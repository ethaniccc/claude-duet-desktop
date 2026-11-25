# Claude Duet Desktop

A desktop app for [Claude Duet](https://claude.com/duet). It shows `claude.ai/duet` in a chat panel that opens from an orb on your desktop.

## Run the app

You must have Node.js 22.12 or later.

```sh
npm install
npm start
```

The first start can take a minute, because Electron downloads its files.

Click the orb to open the chat, then sign in to claude.ai. The app keeps you signed in when you quit it.

Sign in with the code in the sign-in email, or with Apple. Google and SSO do not work in the app: they open your default browser. Do not click the link in the sign-in email, because it also opens your default browser.

## Use the app

- The app shows an orb that floats above your other windows. The orb shows the animated Claude Duet character from the chat page. When the chat page does not show the character, for example before you sign in, the orb shows the Claude logo.
- Drag the orb to move it. The app keeps the orb position for the next start.
- Click the orb to open the chat. The chat opens below the orb. When there is no space below, it opens above or next to the orb. Click the orb again, or click outside the app, to hide the chat.
- On Windows, click the Claude icon in the system tray to hide or show the orb. Right-click the icon for these commands: open the chat, show or hide the orb, or quit the app.
- Hiding the chat or the orb does not stop the app. To stop the app, use Quit in the tray menu.

claude.ai stops the character when it has nothing to do and its page does not have focus. The app changes only this behavior of the character in the chat page, so the character on the orb continues to move while the chat is hidden. The page still knows when the chat does not have focus. But the page always shows as visible, also when the chat is hidden, because the app must keep the page active to draw the character. This is the same as a browser window that you can see on the screen but do not use.

## What the app permits

- Pages on `claude.ai` and the Apple sign-in pages open in the app.
- Other `http`, `https` and `mailto` links open in your default browser. This includes links on `claude.ai` that redirect to a different site.
- Only `claude.ai` can show notifications, use the microphone, and write to the clipboard. The app refuses the camera and screen capture.
- If the page cannot load, for example when you are offline, the app tries again every 5 seconds. If the page stops working again and again, the app waits longer between tries, up to 5 minutes.
