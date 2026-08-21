# dsh-whale-galgame · 跨會話任務事件感知的多角色 Galgame 引擎

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **繁體中文**

## 簡介

在 Harness 執行工作的空檔，探尋你與模型娘間「非比尋常」的同事關係～(∠・ω< )⌒★

`dsh-whale-galgame` 為 DeepSeek Harness Web 掛載一個獨立的多角色輕量 Galgame 遊戲面板。外掛會依事件來源的工作區，用本地確定性規則將近期的除錯、寫作、調查等活動歸為 11 類任務事件，再把不含原文的安全分類結果併入全域事件佇列；進入 Galgame 閒聊時，目前角色可以自然回應剛才的工作。Harness 中使用者提交的原文只參與本地分類，回覆模型僅收到固定的任務類別與狀態提示，工具參數、工具結果和 assistant 回覆正文不會進入這條感知路徑。

預設素材提供了 DeepSeek、Claude、GPT、Gemini、Kimi、Grok 模型所對應的六位獨立萌娘角色，角色立繪與實際回覆模型可以自由選擇。目前角色、每位角色的關係進度與角色設定、對話歷史、回覆選項、已消費任務記憶、自訂立繪、CG 圖鑑、背景，以及 token 結算餘額和外掛偏好，都在工作區之間保持同一份全域連續狀態。工作區和會話只標示 Harness 事件來自哪裡並用於採集去重。好感度由三類回覆選項、外掛執行期間新觀察到的 Harness token 用量和長期未互動共同影響，等級不設上限。設定 DashScope key 後，升級可生成與近期任務呼應的 1920 × 1080 橫向紀念 CG；桌寵可獨立關閉，點擊時會開啟 Galgame。

![dsh-whale-galgame 在 DSH Web 中的實際執行介面](docs/screenshots/galgame-overview.jpg)

## 功能

- 顯示角色與回覆模型分開選擇：角色可以跟隨工作區模型或手動固定；回覆模型可以使用預設的 `deepseek-v4-flash`、跟隨工作區，或從 DSH 模型目錄中選擇。
- 六個角色的好感度、等級、角色設定、聊天記錄、回覆選項、已消費任務記憶、自訂立繪、CG 圖鑑和背景彼此分離，但都在工作區之間全域共享；目前角色、token 結算餘額和外掛偏好也會連續保留。
- 每輪提供親近、普通、疏離三種傾向的回覆，顯示順序隨機；也可以直接輸入內容。
- 切換角色時會同步切換對應的內建背景；鯨魚娘預設仍使用深海宮殿，新的海邊書房可在「背景圖」中選作替代。使用者上傳背景或儲存的 CG 會覆蓋角色預設背景，直到還原內建選項。
- 背景、角色立繪、對話歷史、CG 圖鑑和桌寵均可從介面管理。點擊桌寵會開啟 `galgame` 分頁。

## 好感度與跨對話上下文

### 關係進度

每個角色都從 Lv.1、0 點好感開始，狀態彼此獨立。親近、普通、疏離三個回覆選項分別結算 +1、0、-1，位置每輪隨機；自由輸入使用輕量關鍵字規則結算。外掛執行期間，從所有工作區新觀察到的 Harness `assistant/message` usage 事件會進入同一份全域 token 餘額；輸入與輸出 token 每累計 5,000 個，結算時目前角色增加 1 點。每次結算最多兌換 3 點，餘量繼續保留；外掛自身發起的模型呼叫不計入，也不回算外掛啟動前的歷史 usage。超過 24 小時未活動後，所有角色按每天 2 點衰減，最低為 0。

升級門檻值為 `30 + 15 × (Lv - 1)`，即 30、45、60……。達到門檻後升級，超出部分保留到下一級。等級不設上限。角色語氣隨關係進度分為五檔，Lv.5 後保持最高親暱檔。設定了可用的 DashScope key 時，每次升級會嘗試生成一張特殊 CG。

### Harness 任務事件

外掛會依每個事件來源的工作區，最多檢查該工作區最近 72 小時的 16 個頂層 Harness 會話，包括即時與已儲存的會話，並只掃描每個會話末尾 240 條事件。本地、確定性規則將任務歸為程式碼除錯、程式碼開發、文件總結、文件寫作、文學創作、資料調查、資料分析、視覺設計、簡報製作、翻譯校對或任務規劃，再將安全分類結果合併到全域事件佇列。本地分類只使用真人明確提交的 user 正文，並可參考工具名與輪次結束狀態。

只有固定的任務類別與狀態提示會發給 Galgame 回覆模型和 CG 生成服務。模型娘會在回應目前話題時自然帶到一句相關關心，例如程式碼除錯後提醒主人不要熬夜。每個角色的已消費事件指紋與最近提及時間都儲存在全域狀態中：同一事件不會因為切換工作區而再次向同一角色主動提起，不同事件之間至少間隔 30 分鐘。任務事件只影響話題，不直接增減好感度。

## 內建預設美術

外掛安裝包內嵌並使用 22 項美術素材：六張角色立繪、七張內建背景、八張鯨魚娘表情差分立繪，以及一張來自 [dsh-deepseek-girl-pet](https://github.com/f0909172434/dsh-deepseek-girl-pet) 的 11 行桌寵動畫圖集。下面六張圖是各模型角色的預設立繪；GitHub 原始碼儲存庫中的 [`assets/default/`](assets/default/README.md) 列出了全部圖片及其執行時用途。npm 安裝包只攜帶內嵌後的用戶端 bundle，不重複收錄匯出原圖或生成圖的原始碼。

<table>
  <tr>
    <td align="center"><img src="assets/default/maid-left.webp" width="180" alt="DeepSeek 鯨魚娘預設立繪"><br><strong>DeepSeek · 鯨魚娘</strong></td>
    <td align="center"><img src="assets/default/claude-amber-manuscript-mediator-v5.webp" width="180" alt="Claude 模型娘克洛德預設立繪"><br><strong>Claude · 克洛德</strong></td>
    <td align="center"><img src="assets/default/gpt-recursive-weaver-v7.webp" width="180" alt="GPT 模型娘小吉預設立繪"><br><strong>GPT · 小吉</strong></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/default/gemini-dual-prism-translator-v4.webp" width="180" alt="Gemini 模型娘雙子預設立繪"><br><strong>Gemini · 雙子</strong></td>
    <td align="center"><img src="assets/default/kimi-lunar-scroll-navigator-v5.webp" width="180" alt="Kimi 模型娘月見預設立繪"><br><strong>Kimi · 月見</strong></td>
    <td align="center"><img src="assets/default/grok-cosmic-signal-ranger-v5.webp" width="180" alt="Grok 模型娘洛可預設立繪"><br><strong>Grok · 洛可</strong></td>
  </tr>
</table>

六個角色的新背景如下。Claude、GPT、Gemini、Kimi 和 Grok 預設使用各自背景；DeepSeek 鯨魚娘仍以 `palace-night.webp` 深海宮殿為預設，下圖海邊書房是內建的可選替代。

<table>
  <tr>
    <td align="center"><img src="assets/default/bg-deepseek-seaside-study.webp" width="260" alt="DeepSeek 鯨魚娘海邊書房可選背景"><br><strong>DeepSeek · 可選替代</strong></td>
    <td align="center"><img src="assets/default/bg-claude-writing-study.webp" width="260" alt="Claude 寫作書房預設背景"><br><strong>Claude</strong></td>
    <td align="center"><img src="assets/default/bg-gpt-collaboration-workshop.webp" width="260" alt="GPT 協作工坊預設背景"><br><strong>GPT</strong></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/default/bg-gemini-twin-creative-studio.webp" width="260" alt="Gemini 雙子創意工作室預設背景"><br><strong>Gemini</strong></td>
    <td align="center"><img src="assets/default/bg-kimi-moonlit-reading-study.webp" width="260" alt="Kimi 月下閱讀室預設背景"><br><strong>Kimi</strong></td>
    <td align="center"><img src="assets/default/bg-grok-electronics-studio.webp" width="260" alt="Grok 電子工作室預設背景"><br><strong>Grok</strong></td>
  </tr>
</table>

完整執行時素材還包括八張原始解析度的透明 `whale-*.webp` 表情，以及 8 列 × 11 行的 `pet-spritesheet.webp` 桌寵動畫圖集。前 21 張預設圖片與桌寵圖集採用不同授權；來源、修改內容和逐檔案授權見 [NOTICE](NOTICE.md) 與 [第三方授權索引](THIRD_PARTY_LICENSES.md)。

Galgame 介面的版面配置、對話框、控制項和裝飾隨 [`src/client/index.ts`](src/client/index.ts) 公開，不依賴未公開的 UI 圖片包。

## 安裝

需要已安裝 DeepSeek Harness，並能執行 `dsh` 的 Web profile。

~~~sh
dsh plugin --profile web add dsh-whale-galgame
~~~

安裝完成後，先停止正在執行的 Web profile，再重新啟動：

~~~sh
dsh --profile web
~~~

如果原始碼安裝提供的是 `pnpm dsh`，保留相同參數即可。

### 更新與解除安裝

~~~sh
dsh plugin --profile web update dsh-whale-galgame
dsh plugin --profile web remove dsh-whale-galgame
~~~

更新或解除安裝後同樣需要停止並重新啟動 Web profile。

### 從 GitHub 安裝（追蹤 main 分支）

只有想跟進最新提交、而不是 npm 發行版時才需要這條路徑：

~~~sh
dsh plugin --profile web add github:JAdpp/dsh-whale-galgame#main
~~~

git 安裝會當場執行本儲存庫的 `prepare` 建置指令碼，pnpm 預設會攔截。首次執行會回報 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 並印出一個鍵，把它寫進 profile 的 `pnpm-workspace.yaml`：

~~~yaml
allowBuilds:
  'dsh-whale-galgame@https://codeload.github.com/JAdpp/dsh-whale-galgame/tar.gz/<commit>': true
~~~

該鍵綁死了特定 commit，每次跟進新提交都要依 pnpm 新印出的值更新。**從 npm 安裝完全不涉及這一步**，因為發行的套件已經預先建置，安裝期間不會執行任何指令碼。

## 使用與設定

![DSH Web 中的外掛設定介面](docs/screenshots/plugin-settings.png)

在 Galgame 頂欄可以切換「角色來源」和「實際對話」，也可以上傳背景或目前角色的立繪。背景和立繪支援 PNG、JPEG、WebP、AVIF，瀏覽器端單一檔案上限為 12 MB。

在「设置 → 插件 → 插件配置」（DSH 介面目前只有簡體中文，這裡照原樣列出）中可以啟停外掛、設定預設角色和預設回覆模型。關閉外掛會暫停 Galgame 對話和好感度結算，但不會刪除已有資料。

### 自訂角色設定

在 Galgame 頂欄點擊「角色立繪」旁的「角色設定」，可以編輯目前角色的六項設定：

- 角色暱稱
- 對使用者的稱呼
- 首次問候
- 性格
- 語氣
- CG 外觀描述

六位角色的自訂設定分別儲存，並在所有工作區共享。「儲存設定」或「還原預設」只會修改目前角色的上述六項，不會重設其好感度與等級、長期記憶或自訂立繪。若該角色尚未開始真實對話，修改或還原「首次問候」會就地更新目前的開場問候，自動生成的登場旁白保持不變；一旦已有使用者或角色對話，就不會再插入、替換或重播歷史。CG 外觀描述用於之後生成的升級 CG，不會改寫圖鑑中已經儲存的圖片。

自訂設定不能繞過外掛的安全約束，也不會取消角色回覆的單句限制。

### 內建桌寵

桌寵已經內建在本外掛中，無需另外安裝。新安裝時預設開啟，顯示在 DSH 主介面右下角；點擊桌寵會開啟 `galgame` 分頁。Galgame 頂欄的「桌寵 · 開/關」是獨立開關，只控制桌寵是否顯示。「设置 → 插件 → 插件配置」中的「啟用外掛」控制的是整個外掛；關閉後會隱藏桌寵，並暫停 Galgame 對話和好感度結算。

## 可選的升級 CG

升級 CG 預設透過 DashScope 的 `qwen-image-3.0` 生成，尺寸為 1920 × 1080。沒有 DashScope key 時，聊天、角色切換、歷史、好感度和自訂圖片仍可使用，只有 CG 生成不可用。

建議只透過啟動 DSH 的本地環境變數提供 key：

~~~powershell
$env:DASHSCOPE_API_KEY = 'your-local-key'
dsh --profile web
~~~

~~~sh
DASHSCOPE_API_KEY='your-local-key' dsh --profile web
~~~

不要把真實 key 寫入儲存庫檔案或提交到 Git。

## 資料與隱私

執行時資料分為兩層，請把兩者都當作私人資料處理：

- `DSH_HOME/storages/dsh-whale-galgame/global.json` 儲存完整、連續的 Galgame 狀態：目前角色；六位角色各自的關係進度、角色設定、對話歷史、目前回覆選項、已消費任務記憶、自訂立繪、CG 圖鑑與背景；全域任務事件佇列、token 結算餘額、去重指紋和外掛偏好。
- 目前工作區根目錄的 `.whale-girl-save.json` 只保留輕量的事件來源與舊存檔遷移標記，不再儲存一套獨立的劇情、聊天、任務記憶或 token 帳本。
- 進入新工作區時會直接沿用目前角色、對話歷史、回覆選項和關係進度；工作區或會話僅用於定位 Harness 事件來源與採集去重，不會觸發劇情重來或跨工作區拒絕頁。
- 首次開啟舊版 v9 工作區存檔時，外掛會自動把可遷移的劇情與角色資料合併到上述全域檔案，並將該工作區的 `.whale-girl-save.json` 改寫為來源/遷移標記。

- 普通對話會傳送給你在 DSH 中選擇的模型供應商。
- 生成升級 CG 時，外掛會把文字提示傳送到 DashScope。
- 開啟小劇場的連網取材後（預設開啟），外掛會透過 DSH 的 web 能力發起搜尋。搜尋關鍵字只由角色對應的模型名與題材詞構成，**不包含**你的對話內容、工作區內容或任何 Harness 原文。
- 搜尋結果只用於本次小劇場生成；摘要與來源連結會寫入小劇場記錄（存檔內），網頁正文不會寫入磁碟。
- 在「设置 → 插件 → 插件配置」的「小劇場取材」中選擇「只用本地任務類別」即可完全關閉連網，外掛不會發出任何搜尋請求。
- 生成合照 CG 時，外掛會把角色外觀描述與該場小劇場的情境作為文字提示傳送到 DashScope；這一步需要你手動點擊觸發。
- 使用者上傳的背景和立繪儲存在全域存檔中，不會隨上述兩類外部請求傳送。
- Harness 原文不會寫入 Galgame 存檔。全域狀態只儲存固定的類別與狀態線索、匿名去重指紋和最近提及時間；外部請求中也只包含固定的類別與狀態提示。

本外掛儲存庫的 `.gitignore` 無法自動保護其他工作區。如果目前工作區本身也是 Git 儲存庫，請在該工作區的 `.gitignore` 中加入：

~~~gitignore
.whale-girl-save.json
.whale-girl-save.*.json
~~~

## 開發

~~~sh
npm ci
npm run sanitize:backgrounds
npm run embed:art
npm run export:art
npm run verify
~~~

`lib/` 與 `src/client/art.generated.ts` 是建置產物，不再提交到儲存庫。`prepare` 指令碼會在安裝時執行 `npm run embed:art` 和 `tsdown`，因此從 git 安裝的外掛會自行建置，儲存庫壓縮檔也保持精簡；clone 之後執行一次 `npm install` 即可在本機產生它們。`npm run sanitize:backgrounds` 會移除六張角色背景的非畫面 WebP 中繼資料，`npm run embed:art` 會將白名單原圖寫入執行時，`npm run export:art` 則反向匯出公開的 22 項執行時美術以供核對。

## 授權與致謝

程式碼、Galgame UI 實作與文件採用 [MIT License](LICENSE.md)。六張角色立繪、七張內建背景和八張鯨魚娘表情，共 21 張預設圖片，採用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)；本專案製作的 AI 輔助圖片僅在維護者持有相應權利的範圍內依該授權提供。`pet-spritesheet.webp` 桌寵圖集及直接繼承自 [dsh-deepseek-girl-pet](https://github.com/f0909172434/dsh-deepseek-girl-pet) 的程式碼沿用其 MIT 授權。逐檔案邊界見 [NOTICE](NOTICE.md)，上游授權原文見 [`assets/default/licenses/`](assets/default/licenses/)。

最後，感謝以下創作者把具體作品和實作經驗分享給社群：

- **上善**創作了鯨魚娘的原始角色形象：[Pixiv](https://www.pixiv.net/users/62155430) · [Bilibili](https://space.bilibili.com/4456176)。
- **ZipZipPipe**在鯨魚娘形象上加入 DeepSeek 元素，完成女僕鯨魚娘二創：[Pixiv](https://www.pixiv.net/users/18604994) · [Bilibili](https://space.bilibili.com/4168597)。
- **Small-tailqwq** 在開源專案 [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) 中提供了本外掛沿用的深海宮殿背景。
- **f0909172434 / [dsh-deepseek-girl-pet](https://github.com/f0909172434/dsh-deepseek-girl-pet)** 以 MIT 授權開源了 DSH 鯨魚娘桌寵。本外掛的桌寵功能基於該專案二次開發，`pet-spritesheet.webp` 與上游相同；本專案調整了外掛整合方式與介面樣式，並加入點擊桌寵進入 Galgame 介面的互動。
- Claude、GPT、Gemini、Kimi、Grok 五張模型娘立繪、六張角色日常背景和 Galgame UI 為本專案製作的非官方 AI 輔助素材，不代表相關廠商的官方形象、合作或背書。

如果這些開源素材和實作對你有幫助，歡迎給 [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) 與 [dsh-deepseek-girl-pet](https://github.com/f0909172434/dsh-deepseek-girl-pet) 點個 Star，也可以在 Pixiv 或 Bilibili 關注上善與 ZipZipPipe。外掛安裝、執行或相容性問題請提交到[本儲存庫 Issues](https://github.com/JAdpp/dsh-whale-galgame/issues)，不要打擾素材作者排查外掛程式碼。

DeepSeek、Claude、ChatGPT/GPT、Gemini、Kimi、Grok 等名稱和商標歸各自權利人所有。本專案是非官方社群外掛，與相關廠商不存在隸屬、合作或背書關係。

## dsh galgame 相關專案友情連結

- [gal-view](https://github.com/Ayase34/gal-view) - DSH Web GUI 會話頁的 Galgame 風格對話檢視 + 場景元素視覺化編輯器
- [dsh-galgame](https://github.com/Lanxing6480/dsh-galgame) - GalGame 模式介面外掛
