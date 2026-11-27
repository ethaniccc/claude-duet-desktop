# Claude Duet Desktop

Claude Duet Desktop is an unofficial desktop app for [Claude Duet](https://claude.com/duet). It puts the Claude Duet character in a small orb on your desktop. Click the orb to open the `claude.ai/duet` chat. Anthropic did not make this app.

## Before you start

You must have these items:

- A Claude account that has access to Claude Duet. Claude Duet is a research preview. For the current access rules, see [the Claude Duet page](https://claude.com/duet).
- Windows 10 or later, or macOS 13 or later. We build and test the app on Windows and macOS. Some parts can work on Linux, but we did not test them.
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

The orb floats above your other windows. On macOS, the orb and the chat also show on every desktop and above full-screen apps. The orb shows the animated Claude Duet character from the chat page. When the chat page does not show the character, the orb shows the Claude logo. For example, the orb shows the logo before you sign in.

- To move the orb, drag it. The app keeps the orb position for the next start.
- To open the chat, click the orb. The chat comes out of the orb. It opens below the orb. If there is no space below, it opens above or next to the orb.
- To close the chat, click the orb again or click outside the app. The chat goes back into the orb.
- To change the size of the chat, drag the grip in the corner of the chat that is away from the orb. The grip shows when you move the pointer over that corner. The width can be from 340 to 540 pixels. The height can be from 460 to 880 pixels. On a small screen, the chat can be smaller. The app keeps the size for the next start.
- The app plays a short click sound when the chat opens and a different click sound when the chat closes.

### Open the chat with the keyboard

You can open the chat while you use a different app, for example a game. On Windows, this does not work when the app in front runs as administrator.

The key is Alt on Windows and Command on macOS.

1. Press the key two times quickly. The chat opens, and the cursor goes to the message box.
2. Type your message.
3. Press the key two times quickly again. The chat closes, and you go back to the window that you used before.

Hold each press for 0.4 seconds or less. The two presses must be 0.4 seconds or less apart. If you press another key or a mouse button between the two presses, or while you hold the key, the chat does not open. Thus Alt+Tab and Command+Tab do not open the chat. On Windows, on a keyboard with AltGr, use the left Alt.

On macOS, the app asks you to let it use Accessibility until you allow it. Open **System Settings** > **Privacy & Security** > **Accessibility** and turn on the app. When you start the app with `npm start`, turn on the terminal app that runs it. The keyboard works as soon as you turn it on. You do not have to start the app again.

### Message sound

The app can play a sound when Claude Duet sends you a message. The app plays the sound only when the chat is closed or when you use a different app.

1. Make a folder with the name `sounds` in the `claude-duet-desktop` folder.
2. Put your sound file in the `sounds` folder. Give it the name `message.mp3`, `message.wav`, or `message.ogg`.

You do not have to start the app again. The app finds the file when a message comes in.

The repository does not include a message sound file. If the `sounds` folder has no sound file, the app plays no sound. If the folder has more than one sound file, the app uses `message.mp3` first, then `message.wav`, then `message.ogg`.

When a message comes in several parts, the app plays the sound one time. After the app plays the sound, it does not play the sound again for 3 seconds. The app plays no sound for the first message from Claude Duet in a conversation that does not show other messages from Claude Duet.

### Apple emoji

On macOS, the chat already shows emoji in the Apple style, so you can skip this section.

The app can show emoji in the Apple style. You must get the emoji font from a Mac. The licence of the font does not let the repository include it. Make sure that the licence lets you use the font in this way.

1. On the Mac, copy the file `/System/Library/Fonts/Apple Color Emoji.ttc` to the computer where you use the app.
2. Install Python 3. Then install the tools that the script uses:

   ```
   python -m pip install fonttools uharfbuzz pillow
   ```

3. In the `claude-duet-desktop` folder, run the script with the path of your copy of the font:

   ```
   python scripts/apple-emoji.py "C:\path\to\Apple Color Emoji.ttc"
   ```

   The script downloads the list of emoji sequences from unicode.org. Then it writes the file `fonts/apple-emoji.ttf`.
4. Start the app again.

The app cannot use the Mac font as it is. The font is larger than 128 MB, which is the limit, and it joins emoji such as flags and skin tones in a format that the app cannot read. Thus the script makes the font smaller and writes the joins in a different format.

If the `fonts` folder does not have the file `apple-emoji.ttf`, the app shows the emoji that it showed before. Keycap emoji, for example 1️⃣, do not change to the Apple style. Symbols that can be text or emoji, for example ↔ and ♥, stay as text. They change to the Apple style only when the emoji form of the symbol is used, for example ❤️.

### The system tray and the menu bar

On Windows, the app shows a Claude icon in the system tray. On macOS, the app shows the icon in the menu bar, and it has no icon in the Dock.

- On Windows, to hide or show the orb, click the icon. To see the commands, right-click the icon.
- On macOS, to see the commands, click the icon.

The commands are: open the chat, show or hide the orb, and quit the app.

When you hide the chat or the orb, the app continues to run. To stop the app, click **Quit** in the menu of the icon.

## How the app works

### The character on the orb

claude.ai stops the character when the character has nothing to do and the page does not have focus. The app changes only this behavior of the character. Thus the character on the orb continues to move while the chat is hidden.

The page still knows when the chat does not have focus. But the page always reports that it is visible, also when the chat is hidden. The app must keep the page active to draw the character. This is the same as a browser window that you can see on the screen but do not use.

### Links, permissions, and the keyboard

- Pages on `claude.ai` and the Apple sign-in pages open in the app.
- Other `http`, `https`, and `mailto` links open in your default browser. This includes links on `claude.ai` that go to a different site.
- Only `claude.ai` can show notifications, use the microphone, and write to the clipboard. The app refuses the camera and screen capture.
- To find the double press, the app listens to the keyboard and the mouse of the whole system. The library that the app uses always listens to both. The app uses only the Alt or Command presses, and whether you pressed another key or a mouse button. It does not keep any key. Some antivirus programs show a warning for apps that listen to the keyboard in this way.
- On Windows, to give the keyboard to the chat, the app moves the Windows focus to the chat when the chat opens. When you close the chat with the keyboard or the orb, the app moves the focus back to your previous window. Each time the app moves the focus, it sends a press of the F24 key, which few apps use. If an app has a shortcut on F24, that app gets the press.
- On macOS, a click or a drag on the orb makes the app the active app. The app keeps track of the last other app that was active. When you close the chat, or when you drag the orb while the chat is closed, the app makes that app active again.

### Problems and how the app recovers

- If the page cannot load, the app tries again every 5 seconds. For example, this occurs when you are offline.
- If the page stops working again and again, the app waits longer between tries, up to 5 minutes.

## Known limits

- When the page cannot load, the chat is transparent. A click on the orb then seems to do nothing until the page loads.
- On the claude.ai sign-in page, the bottom corners of the chat are square. The sign-in page is longer than the chat.
- A full-screen game can minimize when the chat opens. The app restores the game when the chat closes.
- The orb and the chat show above the Windows taskbar. If your taskbar hides automatically, the orb can cover the area where the taskbar comes up.

## Develop the app

- The source is in `src/`. The orb page is in `static/`. The script that makes the Apple emoji font is in `scripts/`.
- `npm run build` compiles the TypeScript into `dist/`.
- `npm start` compiles the TypeScript and starts the app.
- The app does not reload when you change the code. Stop the app and start it again.
