# Claude Duet Desktop

Claude Duet Desktop is an unofficial desktop app for [Claude Duet](https://claude.com/duet). It puts the Claude Duet character in a small orb on your desktop. Click the orb to open the `claude.ai/duet` chat. Anthropic did not make this app.

## Before you start

You must have these items:

- A Claude account that has access to Claude Duet. Claude Duet is a research preview. For the current access rules, see [the Claude Duet page](https://claude.com/duet).
- Windows 10 or later. We build and test the app only on Windows. Some parts can work on macOS and Linux, but we did not test them.
- [Node.js](https://nodejs.org/) 22.12 or later.
- [Git](https://git-scm.com/).

## Install the app

1. Clone the repository:

   ```sh
   git clone https://github.com/ethaniccc/claude-duet-desktop.git
   cd claude-duet-desktop
   ```

2. Install the dependencies:

   ```sh
   npm install
   ```

## Start the app

1. Start the app:

   ```sh
   npm start
   ```

   The first start can take about 1 minute, because Electron downloads its files. The orb appears in the bottom-right corner of your main screen.

2. Click the orb. The chat opens.
3. Sign in to claude.ai in the chat. Use the code in the sign-in email, or use Apple.

**Note:** Google sign-in and SSO do not work in the app. They open your default browser. The link in the sign-in email also opens your default browser. In these cases, you do not sign in to the app.

The app keeps you signed in after you quit it.

## Use the app

### The orb

The orb floats above your other windows. It shows the animated Claude Duet character from the chat page. When the chat page does not show the character, the orb shows the Claude logo. For example, the orb shows the logo before you sign in.

- To move the orb, drag it. The app keeps the orb position for the next start.
- To open the chat, click the orb. The chat comes out of the orb. It opens below the orb. If there is no space below, it opens above or next to the orb.
- To close the chat, click the orb again or click outside the app. The chat goes back into the orb.

### Open the chat with the keyboard

You can open the chat while you use a different app, for example a game. This does not work when the app in front runs as administrator.

1. Press Alt two times quickly. The chat opens, and the cursor goes to the message box.
2. Type your message.
3. Press Alt two times quickly again. The chat closes, and you go back to the window that you used before.

Hold each Alt press for 0.4 seconds or less. The two Alt presses must be 0.4 seconds or less apart. If you press another key or a mouse button between the two presses, or while you hold Alt, the chat does not open. Thus Alt+Tab and Alt+F4 do not open the chat. On a keyboard with AltGr, use the left Alt.

### The system tray

On Windows, the app shows a Claude icon in the system tray.

- To hide or show the orb, click the icon.
- To see the commands, right-click the icon. The commands are: open the chat, show or hide the orb, and quit the app.

When you hide the chat or the orb, the app continues to run. To stop the app, click **Quit** in the tray menu.

## How the app works

### The character on the orb

claude.ai stops the character when the character has nothing to do and the page does not have focus. The app changes only this behavior of the character. Thus the character on the orb continues to move while the chat is hidden.

The page still knows when the chat does not have focus. But the page always reports that it is visible, also when the chat is hidden. The app must keep the page active to draw the character. This is the same as a browser window that you can see on the screen but do not use.

### Links, permissions, and the keyboard

- Pages on `claude.ai` and the Apple sign-in pages open in the app.
- Other `http`, `https`, and `mailto` links open in your default browser. This includes links on `claude.ai` that go to a different site.
- Only `claude.ai` can show notifications, use the microphone, and write to the clipboard. The app refuses the camera and screen capture.
- To find the double Alt press, the app listens to the keyboard and the mouse of the whole system. The library that the app uses always listens to both. The app uses only the Alt presses, and whether you pressed another key or a mouse button. It does not keep any key. Some antivirus programs show a warning for apps that listen to the keyboard in this way.
- To give the keyboard to the chat, the app moves the Windows focus to the chat when the chat opens. When you close the chat with the keyboard or the orb, the app moves the focus back to your previous window. Each time the app moves the focus, it sends a press of the F24 key, which few apps use. If an app has a shortcut on F24, that app gets the press.

### Problems and how the app recovers

- If the page cannot load, the app tries again every 5 seconds. For example, this occurs when you are offline.
- If the page stops working again and again, the app waits longer between tries, up to 5 minutes.

## Known limits

- When the page cannot load, the chat is transparent. A click on the orb then seems to do nothing until the page loads.
- On the claude.ai sign-in page, the bottom corners of the chat are square. The sign-in page is longer than the chat.
- A full-screen game can minimize when the chat opens. The app restores the game when the chat closes.
- The orb and the chat show above the Windows taskbar. If your taskbar hides automatically, the orb can cover the area where the taskbar comes up.

## Develop the app

- The source is in `src/`. The orb page is in `static/`.
- `npm run build` compiles the TypeScript into `dist/`.
- `npm start` compiles the TypeScript and starts the app.
- The app does not reload when you change the code. Stop the app and start it again.
