// 親リポジトリに置かれた web_demos.json があれば src/assets/web_demos.json に上書きコピーする。
// dev / build のたびに実行され、親 JSON が存在しない場合は既存ファイルを温存する。
//
// 配置: <plugin>/webui/scripts/sync-web-demos.cjs
//   FROM = <plugin>/../..       /web_demos.json   (= JUCE/web_demos.json)
//   TO   = <plugin>/webui/src/assets/web_demos.json
const fs = require('node:fs');
const path = require('node:path');

const FROM = path.resolve(__dirname, '..', '..', '..', 'web_demos.json');
const TO   = path.resolve(__dirname, '..', 'src', 'assets', 'web_demos.json');

if (fs.existsSync(FROM))
{
  fs.copyFileSync(FROM, TO);
  console.log(`[sync-web-demos] copied ${FROM} -> ${TO}`);
}
else
{
  console.log(`[sync-web-demos] no source at ${FROM}; keeping existing ${TO}`);
}
