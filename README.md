# MiseChat

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Forked from ChatterUI](https://img.shields.io/badge/Forked_from-ChatterUI-orange.svg)](https://github.com/Vali-98/ChatterUI)

> **繁體中文：** 最新版本的 APK 可至 [Releases](https://github.com/baroquee2-dev/MiseChat/releases) 頁面下載（目前僅支援 Android）。  
> **English:** The latest APK is on the [Releases](https://github.com/baroquee2-dev/MiseChat/releases) page (Android only for now).

<p align="center">
  <strong>Language / 語言</strong><br />
  <a href="#chinese">繁體中文</a>
  &nbsp;|&nbsp;
  <a href="#english">English</a>
</p>

---

## Chinese

## 軟體說明

<p align="center">
  <strong>繁體中文</strong>
  &nbsp;|&nbsp;
  <a href="#english">English</a>
</p>

這是一款運行於 **Android** 手機上的 AI 角色扮演聊天 App，主要特色是提供三種不同風格的聊天介面：

1. **視覺小說（Visual Novel）**
   採用類似一般視覺小說／AVG 遊戲的畫面配置，讓角色對話更接近閱讀與遊玩視覺小說的體驗。

2. **沉浸式介面**
   以全畫面角色圖搭配透明對話框，減少介面元素的干擾，讓角色與對話成為畫面的核心。

3. **訊息介面**
   模擬一般即時通訊軟體的聊天形式，提供更自然、熟悉的日常對話體驗。

使用者可以依照不同的聊天情境與喜好，在三種介面之間快速切換。

本 App 的主要目標，是提升 AI 角色扮演聊天的沉浸感：你可以像使用通訊軟體一樣與虛擬的朋友或戀人交談，也可以切換成視覺小說風格，讓對話更接近閱讀一部屬於自己的 Visual Novel。

<p align="center">
  <img src="assets/readme/visual-novel.png" alt="視覺小說介面" width="240" />
  &nbsp;
  <img src="assets/readme/immersive.png" alt="沉浸式介面" width="240" />
  &nbsp;
  <img src="assets/readme/messenger.png" alt="訊息介面" width="240" />
</p>

<p align="center">
  <em>視覺小說　｜　沉浸式　｜　訊息</em>
</p>

## 開始使用前

MiseChat **本身不提供 AI**，它是一個介面，需要你自備一組 AI 服務的 API 金鑰。

支援的服務：**Google AI Studio**、**OpenAI**、**Claude**、**xAI**、**Cohere**、**OpenRouter**，以及任何相容 OpenAI 格式的端點。

如果你還沒有金鑰，Google AI Studio 有免費額度，是最省事的起點。金鑰只會存在你自己的手機上，App 不會把它送到任何第三方。

因為運算都在遠端，手機效能不影響生成品質，但**使用時需要網路連線**。

## 主要功能

### 角色

匯入標準的角色卡（含角色資料的 PNG 檔），每個角色可以有多組開場白、多段獨立的對話。

### 記憶

長對話最大的問題是 AI 會忘記前面發生的事。MiseChat 提供四種互補的做法，都可以各自開關：

| 功能 | 做什麼 | 成本 |
|---|---|---|
| **自動摘要** | 對話變長時，讓 AI 整理出劇情走向與關係變化 | 每次整理一次 API 呼叫 |
| **關鍵事實提取** | 把設定、偏好、約定抽成結構化的條目，可手動檢視與編輯 | 每次提取一次 API 呼叫 |
| **關鍵字檢索** | 從舊訊息裡找出與你剛說的話相關的幾則，補回對話細節 | 完全在手機上運算，不花錢 |
| **劇情作弊器** | 寫下你想要的劇情走向，每次回覆都會參考，角色不會知道 | 無 |

前兩個是壓縮，記得住大方向；關鍵字檢索是取回原文，補的是摘要留不住的具體細節。

### 語音與對嘴

文字轉語音支援**裝置內建**、**ElevenLabs**、**Gemini**、**Cartesia**，可以設定成只朗讀對白、跳過場景描述。

角色動畫對嘴有兩種路線：

- **LemonSlice** — 即時生成會說話的角色影像。需要分別申請 LemonSlice 與 Daily 的金鑰，前者需付費。
- **嘴型圖對嘴** — 用 AI 生成角色的幾張嘴型圖，播放語音時輪播。一次性生成，之後不再花費。

### 外觀

十組內建配色，深色淺色都有，也可以匯入自訂主題（見 [CustomThemes.md](docs/CustomThemes.md)）。可設定跟隨手機的深淺色模式。

### 備份

備份與還原可以勾選範圍，階層是「角色 → 聊天紀錄 → 附件檔案」與「系統設定 → API 金鑰」。附件與背景圖是真的打包進去，不只是資料庫。

### 語言

介面提供繁體中文與英文。

## 設計取向

MiseChat 是從 ChatterUI 分支出來的，但走向已經明顯不同。

ChatterUI 是一套通用的 LLM 聊天平台，兼顧一般使用者與想調參數、看底層行為的進階使用者。MiseChat 則把目標收斂成**角色扮演與沉浸體驗**，並為此刻意拿掉了不少東西：

- **本地 LLM** — 手機跑得動的模型，角色扮演的表現跟遠端服務差距太大，而維護這條路線的成本（模型下載、記憶體管理、相容性）會排擠掉體驗本身的開發。
- **Text Completion** — 只保留 Chat Completions，少一套格式要維護。
- **大量進階設定** — 隱藏文字過濾、停止序列編輯、標籤隱藏、通知等等。設定項目愈多，第一次打開 App 的人愈難開始。

取捨的原則是：如果一個功能需要使用者先理解 LLM 的運作方式才用得起來，它就不適合留在這裡。

## 發展目標

目前角色扮演聊天所需的主要功能都已具備，包含長期記憶的幾種做法。

接下來想補的方向：

* 世界設定（World Info / Lorebook）
* 更多與角色互動及沉浸體驗相關的功能

在增加功能的同時，仍會盡可能維持介面的簡單、直覺與易用，避免隨著功能增加而讓操作流程變得過度複雜。

長期目標是從一名 **ACG 愛好者**的角度出發，持續探索 AI 角色互動、視覺小說與虛擬世界體驗之間的可能性。

### 註記

本專案是基於 [ChatterUI](https://github.com/Vali-98/ChatterUI) 發展而來的分支。

ChatterUI 是一套功能完整的 LLM 聊天平台，同時支援本地與遠端 LLM，並提供簡潔、易於理解的操作介面。它在易用性與進階功能之間的平衡，是我選擇它作為 MiseChat 開發基礎的主要原因。

如果你需要本地 LLM、Text Completion，或是更細緻的參數控制，請直接使用 ChatterUI，那些功能在 MiseChat 裡已經移除。

## 授權與來源

MiseChat 是基於 [ChatterUI](https://github.com/Vali-98/ChatterUI) 的衍生專案，以 ChatterUI **0.9 版本**為基礎並整合了部分 dev 版的後續更新，自 **2026 年**起持續修改與開發。本專案由個人獨立維護，不是 ChatterUI 的官方版本，也不代表原專案或其貢獻者。

程式碼以 **GNU Affero General Public License v3.0（AGPL-3.0）** 授權發布，完整條款見 [LICENSE](./LICENSE)。你可以依其條款使用、研究、修改與再散布；若你修改後再散布，或將修改版部署為網路服務供他人互動使用，需依授權提供對應的完整原始碼。本專案保留 ChatterUI 及其他第三方元件中適用的著作權與授權聲明。

相較原專案的主要變更包含視覺小說與沉浸式聊天介面、長期記憶、語音朗讀與角色對嘴、可選範圍的備份，以及移除本地 LLM、Text Completion 與部分進階設定；完整的變更內容與日期可在本專案的 Git commit history 查閱。

**MiseChat 的名稱、Logo、App Icon 與其他品牌素材不在 AGPL-3.0 的授權範圍內。** 製作衍生版本時請改用你自己的名稱與圖示，避免讓人誤認為與本專案有官方關係。

本專案包含或依賴的第三方函式庫、字型、圖片與其他素材，各自適用其原本的授權條款。

## 使用方式

可從本專案的 [Releases](https://github.com/baroquee2-dev/MiseChat/releases) 頁面下載並安裝最新 APK。

<i>目前以 Android 為主；iOS 尚未提供正式建置。</i>

## 開發與建置

### Android

若要在本機執行開發版，可依下列步驟：

- 安裝任意 **Java 17 / 21** SDK
- 透過 **Android Studio** 安裝 `android-sdk`
- 複製本專案：

```
git clone https://github.com/baroquee2-dev/MiseChat.git
cd MiseChat
```

- 安裝相依套件並以 Expo 執行：

```
npm install
npx expo run:android
```

或使用專案腳本（會以開發變體建置，App 名稱顯示為 `MiseChat (DEV)`）：

```
npm run dev:android
```

#### 建置 APK

需要 **Node.js**、**Java 17/21 SDK** 與 **Android SDK**。

##### 方法一：Expo EAS 本機建置

Expo 使用 EAS 建置 App；官方文件以 Linux 環境為主，Windows 使用者也可改用下方的 Gradle 方式。

1. Clone 本專案。
2. 將 `eas.json.example` 重新命名為 `eas.json`。
3. 修改 `"ANDROID_SDK_ROOT"`，指向本機的 Android SDK 目錄。
4. 執行：

```
npm install
eas build --platform android --local
```

##### 方法二：Gradle 直接建置（適合 Windows）

1. 先產生原生專案（請勿帶 `APP_VARIANT=development`，否則會得到 DEV 版）：

```
npx expo prebuild --platform android --clean
```

2. 進入 `android` 目錄並建置 Release APK，例如只編譯 `arm64-v8a`：

```
cd android
./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Windows PowerShell / CMD 可改用：

```
cd android
gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

產出的 APK 通常位於：

```
android/app/build/outputs/apk/release/
```

> **注意：** 若環境變數設了 `APP_VARIANT=development`，或使用 `npm run prebuild` / `npm run dev:android`，建置結果會是開發用套件（`MiseChat (DEV)`、`com.baroquee2.misechat.dev`）。正式版請不要帶入此變數。

### iOS

目前尚未提供正式支援。

## 額外說明

我是 GitHub 的新手，目前仍在熟悉 GitHub 的使用方式與開源專案的相關慣例。

如果專案在文件、程式碼管理、授權標示或其他方面有不完善之處，歡迎提出建議與指正。

感謝你的理解與協助！

---

## English

<p align="center">
  <a href="#chinese">繁體中文</a>
  &nbsp;|&nbsp;
  <strong>English</strong>
</p>

## About the App

This is an AI role-playing chat app for **Android**, featuring three different chat interfaces designed for different styles of interaction:

1. **Visual Novel Mode**
   Inspired by the layout of traditional visual novels and AVG games, providing a conversation experience that feels closer to reading or playing a visual novel.

2. **Immersive Mode**
   Uses full-screen character artwork with a transparent dialogue box, minimizing interface distractions and keeping the focus on the character and conversation.

3. **Messaging Mode**
   Designed to resemble a familiar instant messaging app, creating a more natural and casual experience for everyday conversations.

Users can quickly switch between these three interfaces depending on the conversation, character, or personal preference.

The primary goal of this app is to create a more immersive AI role-playing experience. You can chat with a virtual friend or romantic partner through a familiar messaging-style interface, or switch to a visual novel layout to make the conversation feel more like experiencing your own interactive Visual Novel.

## Before You Start

MiseChat **does not provide the AI**. It is a front end, and you supply an API key for an AI service of your choosing.

Supported services: **Google AI Studio**, **OpenAI**, **Claude**, **xAI**, **Cohere**, **OpenRouter**, and any OpenAI-compatible endpoint.

If you do not have a key yet, Google AI Studio has a free tier and is the easiest place to start. Keys are stored only on your own phone; the app never sends them anywhere else.

Because generation happens remotely, your phone's performance does not affect output quality — but you do need an internet connection.

## Features

### Characters

Import standard character cards (PNG files carrying character data). Each character can have several greetings and any number of separate chats.

### Memory

The hardest part of a long conversation is that the model forgets what happened earlier. MiseChat offers four complementary approaches, each switched on or off independently:

| Feature | What it does | Cost |
|---|---|---|
| **Auto summary** | As a chat grows, has the AI condense the plot and how relationships changed | One API call per update |
| **Key fact extraction** | Pulls settings, preferences and promises into structured entries you can read and edit | One API call per update |
| **Keyword recall** | Finds older messages that share wording with what you just said and feeds them back | Runs entirely on your phone, free |
| **Plot Cheat** | Write where you want the story to go; every reply follows it, and the character never sees it | None |

The first two compress, so they hold the shape of a story. Keyword recall returns the original text, which is what the summary cannot keep.

### Voice and lip sync

Text to speech supports the **device voice**, **ElevenLabs**, **Gemini** and **Cartesia**, and can be set to read only spoken lines, skipping narration.

Lip sync comes in two forms:

- **LemonSlice** — generates a live talking portrait. Needs separate LemonSlice and Daily keys; LemonSlice is the paid one.
- **Mouth sprites** — generates a few mouth shapes for the character with AI, then cycles them while speech plays. Generated once, free afterwards.

### Appearance

Ten built-in colour schemes, light and dark, plus custom themes (see [CustomThemes.md](docs/CustomThemes.md)). Can follow the phone's light/dark setting.

### Backups

Backup and restore let you tick what to include, nested as Characters → Chats → Attachments, and Settings → API keys. Attachments and backgrounds are really packed in, not just the database.

### Languages

The interface is available in Traditional Chinese and English.

## Design Direction

MiseChat started as a fork of ChatterUI but has since moved in a clearly different direction.

ChatterUI is a general-purpose LLM chat platform, serving both casual users and advanced ones who want to tune parameters and inspect behaviour. MiseChat narrows the target to **role-play and immersion**, and has deliberately dropped a fair amount along the way:

- **Local LLMs** — models small enough to run on a phone fall far short of remote services at role-play, and maintaining that path (model downloads, memory management, compatibility) crowds out work on the experience itself.
- **Text completion** — only chat completions remain, which is one prompt format fewer to maintain.
- **A long tail of advanced settings** — regex text filters, stop sequence editing, tag hiding, notifications and more. The more settings there are, the harder it is to begin.

The rule behind these cuts: if a feature requires understanding how an LLM works before it can be used, it does not belong here.

## Development Goals

The features needed for role-playing chat are in place, including several approaches to long-term memory.

Planned next:

* World info / lorebooks
* More features around character interaction and immersion

As new functionality is introduced, keeping the interface simple, intuitive, and easy to use will remain an important design goal. More features should not necessarily mean more complexity for the user.

The long-term goal is to approach development from the perspective of an **ACG enthusiast**, exploring the possibilities between AI character interaction, visual novels, and virtual worlds.

### Note

This project is a fork built upon [ChatterUI](https://github.com/Vali-98/ChatterUI).

ChatterUI is a full-featured LLM chat platform that supports both local and remote LLMs while providing a clean and approachable user interface. That balance between accessibility and advanced functionality is the main reason I chose it as the foundation for MiseChat.

If you need local LLMs, text completion, or finer control over parameters, use ChatterUI directly — those features have been removed from MiseChat.

## License & Origin

MiseChat is a derivative of [ChatterUI](https://github.com/Vali-98/ChatterUI), built on **ChatterUI 0.9** with selected updates from its dev branch, and modified continuously since **2026**. It is maintained independently by one person: it is not an official ChatterUI release and does not represent that project or its contributors.

The source is released under the **GNU Affero General Public License v3.0 (AGPL-3.0)**; the full terms are in [LICENSE](./LICENSE). You may use, study, modify and redistribute it under those terms. If you redistribute a modified version, or deploy one as a network service for others to interact with, you must make the corresponding source available under the same licence. Copyright and licence notices from ChatterUI and third-party components are retained.

The main changes from the original are the visual novel and immersive chat interfaces, long-term memory, text to speech and character lip sync, scoped backups, and the removal of local LLM support, text completion and a number of advanced settings. The full record is in this repository's Git commit history.

**The MiseChat name, logo, app icon and other brand assets are not covered by the AGPL-3.0 grant.** If you build a derivative, please use your own name and icons so nobody mistakes it for an official release.

Third-party libraries, fonts, images and other assets included here remain under their own licences.

## Usage

Download and install the latest APK from this project's [Releases](https://github.com/baroquee2-dev/MiseChat/releases) page.

<i>Android is the primary target; iOS builds are not currently provided.</i>

## Development

### Android

To run a development build, follow these steps:

- Install any **Java 17 / 21** SDK of your choosing
- Install `android-sdk` via **Android Studio**
- Clone the repo:

```
git clone https://github.com/baroquee2-dev/MiseChat.git
cd MiseChat
```

- Install dependencies via npm and run via Expo:

```
npm install
npx expo run:android
```

Or use the project script (this builds the development variant, shown as `MiseChat (DEV)`):

```
npm run dev:android
```

#### Building an APK

Requires **Node.js**, a **Java 17/21 SDK**, and the **Android SDK**.

##### Option 1: Expo EAS local build

Expo uses EAS to build apps. The documented flow assumes a Linux environment; on Windows you may prefer the Gradle option below.

1. Clone the repo.
2. Rename `eas.json.example` to `eas.json`.
3. Modify `"ANDROID_SDK_ROOT"` to point to your Android SDK directory.
4. Run:

```
npm install
eas build --platform android --local
```

##### Option 2: Build with Gradle (handy on Windows)

1. Generate the native project (do **not** set `APP_VARIANT=development`, or you will get a DEV build):

```
npx expo prebuild --platform android --clean
```

2. Enter the `android` directory and build a release APK, for example arm64-v8a only:

```
cd android
./gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

On Windows PowerShell / CMD:

```
cd android
gradlew app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The APK is typically written to:

```
android/app/build/outputs/apk/release/
```

> **Note:** If `APP_VARIANT=development` is set, or you use `npm run prebuild` / `npm run dev:android`, the result is a development package (`MiseChat (DEV)`, `com.baroquee2.misechat.dev`). Omit that variable for a production-named build.

### iOS

Currently not supported.

## Additional Note

I'm relatively new to GitHub and still learning its ecosystem, workflows, and open-source conventions.

If anything in this project—such as the documentation, repository structure, source attribution, or licensing information—could be improved, feedback and corrections are always welcome.

Thank you for your understanding and support!
