# Exam Attendance (React Native / Expo)

An Android app version of the Exam Attendance & Name List Manager:

- Your 86 names are built in. Add, edit or remove names; everything saves automatically on the phone.
- Tick who is present (big tap areas), search, Select all / Clear all (works on search results too).
- Exam title (Tamil works) and a date picker.
- Make a **PDF** or **Word (.docx)** list of present names → **Share** (WhatsApp, Gmail, Drive…) or **Save to a folder** (e.g. Download).
- ⋮ menu: **Backup names** (.json), **Restore names** from a .json file, **New exam day** (clears ticks and title).
- Ticks, title and date are remembered even if the app is closed.

---

## Get the APK — pick ONE way

### Way 1: Expo cloud build (easiest, works on Windows)
1. Install **Node.js LTS** from https://nodejs.org
2. Make a free account at https://expo.dev
3. Unzip this folder, open a terminal (Command Prompt) inside it and run:
   ```
   npm install
   npx eas-cli@latest login
   npx eas-cli@latest build -p android --profile preview
   ```
4. Answer **Yes** when it asks to create the project and to generate a keystore.
5. After about 10–15 minutes it prints a link. Open it on your phone, download the **.apk** and install it
   (allow "Install unknown apps" for your browser or Files app when Android asks).

### Way 2: GitHub builds it for you (nothing to install)
1. Create a new repository on https://github.com and upload all files from this folder (including the hidden `.github` folder).
2. Open the **Actions** tab → **Build Android APK** → **Run workflow**.
3. When it finishes (~15 min), open the run and download **ExamAttendance-apk** from *Artifacts*. Unzip it to get the .apk.

### Way 3: Android Studio on your own computer
1. Install Node.js LTS and Android Studio (with the Android SDK and JDK 17).
2. In this folder run:
   ```
   npm install
   npx expo prebuild -p android
   cd android
   gradlew assembleRelease
   ```
3. The APK is at `android/app/build/outputs/apk/release/app-release.apk`.

### Just want to try it first?
Install **Expo Go** from the Play Store, run `npm install` then `npx expo start` in this folder,
and scan the QR code with Expo Go.

---

## Files
- `App.tsx` – the screen (list, ticks, search, add/edit/remove, menus)
- `src/storage.ts` – saving names and today's ticks on the phone
- `src/exporters.ts` – PDF, Word and backup files, Share / Save to folder
- `src/data/names.json` – the built-in name list (edit this to change the starting list)
- `app.json` – app name, icon, Android package `com.examattendance.app`
- `eas.json` – the "preview" profile builds an installable .apk
