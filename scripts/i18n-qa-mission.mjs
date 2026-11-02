// Adds the Tamil/English keys introduced by the QA mission (nav split,
// location label, read-aloud, background notifications, error handling).
// Existing keys are never overwritten. The files keep their UTF-8 BOM and
// CRLF line endings. Run: node scripts/i18n-qa-mission.mjs
import fs from "node:fs";

const KEYS = {
  "nav.soilScan": ["மண் பரிசோதனை", "Soil Scan"],
  "nav.diseaseScan": ["நோய் பரிசோதனை", "Disease Scan"],

  "location.notSet": ["இடம் குறிப்பிடப்படவில்லை", "Location not set"],
  "location.gpsApprox": ["உங்கள் GPS இருப்பிடம் (தோராயமாக)", "Your GPS location (approx.)"],
  "location.deniedHelp": [
    "இருப்பிட அனுமதி மறுக்கப்பட்டுள்ளது. இயக்க: உலாவியின் முகவரிப் பட்டையில் உள்ள பூட்டு ஐகான் → தள அமைப்புகள் → இருப்பிடம் → அனுமதி. பிறகு மீண்டும் முயலவும், அல்லது கீழே மாவட்டத்தைத் தேர்வு செய்யவும்.",
    "Location permission is blocked. To allow it: tap the lock icon in the browser's address bar → Site settings → Location → Allow, then try again. Or pick your district below.",
  ],
  "location.timeout": [
    "இருப்பிடம் கிடைக்க நேரம் ஆனது. வெளியே திறந்த இடத்தில் மீண்டும் முயலவும், அல்லது மாவட்டத்தைத் தேர்வு செய்யவும்.",
    "Getting your location took too long. Try again outdoors, or pick your district.",
  ],
  "location.retry": ["மீண்டும் முயல்", "Try again"],

  "voice.readPage": ["இந்தப் பக்கத்தை வாசித்துக் காட்டு", "Read this page aloud"],
  "voice.readPageShort": ["வாசி", "Read aloud"],
  "voice.barLabel": ["வாசிப்புக் கட்டுப்பாடுகள்", "Read-aloud controls"],
  "voice.loading": ["குரல் தயாராகிறது…", "Preparing voice…"],
  "voice.speaking": ["வாசிக்கிறது…", "Reading…"],
  "voice.speakingPart": ["வாசிக்கிறது: பகுதி {n} / {total}", "Reading part {n} of {total}"],
  "voice.paused": ["இடைநிறுத்தப்பட்டது", "Paused"],
  "voice.pausedPart": ["இடைநிறுத்தம்: பகுதி {n} / {total}", "Paused at part {n} of {total}"],
  "voice.pause": ["இடைநிறுத்து", "Pause"],
  "voice.resume": ["தொடர்", "Resume"],
  "voice.next": ["அடுத்த பகுதி", "Next section"],
  "voice.restart": ["மீண்டும் தொடக்கம்", "Restart"],
  "voice.stop": ["நிறுத்து", "Stop"],
  "voice.dismiss": ["மூடு", "Dismiss"],
  "voice.switchToEnglish": ["ஆங்கிலத்துக்கு மாறு", "Switch to English"],
  "voice.error.unsupported": [
    "இந்த உலாவியில் உரையைப் பேச்சாக்கும் வசதி இல்லை. Chrome அல்லது Edge பயன்படுத்தவும்.",
    "This browser cannot read text aloud. Use Chrome or Edge.",
  ],
  "voice.error.empty": ["இந்தப் பக்கத்தில் வாசிக்க உரை இல்லை.", "There is no text to read on this page."],
  "voice.error.synthesis_failed": [
    "வாசிப்பு நின்றுவிட்டது. மீண்டும் முயலவும்.",
    "Reading stopped because the voice engine failed. Please try again.",
  ],
  "voice.error.no_voice": [
    "இந்த சாதனத்தில் தமிழ் குரல் நிறுவப்படவில்லை, எனவே வாசிக்கவில்லை.",
    "No voice for this language is installed on this device, so nothing was read.",
  ],
  "voice.installTamil.android": [
    "Android: அமைப்புகள் → அமைப்பு → மொழிகள் → உரையிலிருந்து பேச்சு → Google பேச்சு சேவை → குரல் தரவை நிறுவு → தமிழ்.",
    "Android: Settings → System → Languages → Text-to-speech → Speech Services by Google → Install voice data → Tamil.",
  ],
  "voice.installTamil.windows": [
    "Windows: அமைப்புகள் → நேரம் & மொழி → பேச்சு → குரல்களைச் சேர் → தமிழ், பிறகு உலாவியை மீண்டும் திறக்கவும்.",
    "Windows: Settings → Time & language → Speech → Add voices → Tamil, then reopen the browser.",
  ],
  "voice.installTamil.other": [
    "iPhone/Mac-இல் தமிழ் குரல் கிடைக்காமல் இருக்கலாம்; அப்போது ஆங்கிலத்தில் வாசிக்கலாம்.",
    "iPhone and Mac may not offer a Tamil voice; you can read the page in English instead.",
  ],

  "notify.title": ["பின்னணி அறிவிப்புகள்", "Background notifications"],
  "notify.intro": [
    "செயலி மூடியிருந்தாலும் இன்றைய பணிகள் மற்றும் விலை எச்சரிக்கைகளை அறிவிப்பாகக் காட்டும்.",
    "Shows today's tasks and price alerts as notifications, even when the app is closed.",
  ],
  "notify.enable": ["அறிவிப்புகளை இயக்கு", "Enable notifications"],
  "notify.disable": ["பின்னணி சோதனையை நிறுத்து", "Turn off background checks"],
  "notify.test": ["சோதனை அறிவிப்பு அனுப்பு", "Send a test notification"],
  "notify.testBody": ["அறிவிப்புகள் வேலை செய்கின்றன.", "Notifications are working."],
  "notify.testFailed": ["சோதனை அறிவிப்பைக் காட்ட முடியவில்லை.", "The test notification could not be shown."],
  "notify.unsupported": [
    "இந்த உலாவி அறிவிப்புகளை ஆதரிக்கவில்லை. செயலி திறந்திருக்கும்போது மட்டும் நினைவூட்டல்கள் தோன்றும்.",
    "This browser does not support notifications. Reminders appear only while the app is open.",
  ],
  "notify.denied": [
    "அறிவிப்பு அனுமதி மறுக்கப்பட்டுள்ளது. இயக்க: முகவரிப் பட்டையின் பூட்டு ஐகான் → தள அமைப்புகள் → அறிவிப்புகள் → அனுமதி.",
    "Notifications are blocked. To allow them: lock icon in the address bar → Site settings → Notifications → Allow.",
  ],
  "notify.granted": ["அறிவிப்புகள் அனுமதிக்கப்பட்டன.", "Notifications are allowed."],
  "notify.bgActive": [
    "பின்னணி சோதனை இயக்கத்தில் உள்ளது. சோதனை எப்போது நடக்கும் என்பதை உலாவி தீர்மானிக்கும் (பொதுவாக சில மணி நேரத்துக்கு ஒருமுறை, இணையம் இருக்கும்போது).",
    "Background checks are on. The browser decides when they run (usually every few hours, when online).",
  ],
  "notify.bgUnavailable": [
    "இந்த உலாவி பின்னணி சோதனையை அனுமதிக்கவில்லை. செயலியை நிறுவி (முகப்புத் திரையில் சேர்) Chrome அல்லது Edge-இல் பயன்படுத்தினால் கிடைக்கலாம். இப்போது, செயலி திறந்திருக்கும்போது அல்லது பின்னணியில் இருக்கும்போது மட்டும் அறிவிப்புகள் வரும்.",
    "This browser does not allow background checks. They may become available if you install the app (Add to Home screen) in Chrome or Edge. For now, notifications come only while the app is open or in a background tab.",
  ],
  "notify.limits": [
    "குறிப்பு: இது சர்வர் புஷ் அல்ல. உலாவி பின்னணி சோதனையை தாமதிக்கலாம் அல்லது தவிர்க்கலாம்; iPhone மற்றும் Firefox-இல் இது இயங்காது.",
    "Note: this is not server push. The browser may delay or skip background checks, and they do not run on iPhone or Firefox.",
  ],
  "notify.tasksTitle": ["இன்றைய பண்ணைப் பணிகள்", "Farm tasks due"],
  "notify.priceTitle": ["விலை எச்சரிக்கை", "Price alert"],
  "notify.priceAbove": ["{commodity}: {market}-இல் ₹{modal}/குவிண்டால் (இலக்கு ₹{threshold}-க்கு மேல்)", "{commodity}: ₹{modal}/quintal at {market} (above your ₹{threshold} target)"],
  "notify.priceBelow": ["{commodity}: {market}-இல் ₹{modal}/குவிண்டால் (இலக்கு ₹{threshold}-க்கு கீழ்)", "{commodity}: ₹{modal}/quintal at {market} (below your ₹{threshold} target)"],
  "notify.priceChange": ["{commodity}: {market}-இல் விலை ₹{previous} → ₹{modal}/குவிண்டால்", "{commodity}: price at {market} moved ₹{previous} → ₹{modal}/quintal"],

  "errors.chunkLoad": [
    "இந்தப் பக்கத்தை ஏற்ற முடியவில்லை. இணையத்தைச் சரிபார்த்து மீண்டும் ஏற்றவும்.",
    "This page could not be loaded. Check your connection and reload.",
  ],
  "errors.reload": ["மீண்டும் ஏற்று", "Reload"],
  "errors.unexpected": ["எதிர்பாராத பிழை ஏற்பட்டது. உங்கள் தகவல் பாதுகாப்பாக உள்ளது.", "Something unexpected went wrong. Your data is safe."],
  "errors.details": ["தொழில்நுட்ப விவரம்", "Technical details"],
  "errors.imageInvalid": ["இது படக் கோப்பு அல்ல. JPG, PNG அல்லது WebP படத்தைத் தேர்வு செய்யவும்.", "That is not an image. Choose a JPG, PNG or WebP photo."],
  "errors.imageTooLarge": ["படம் மிகப் பெரியது (அதிகபட்சம் {mb} MB).", "The image is too large (maximum {mb} MB)."],
  "errors.imageUnreadable": ["இந்தப் படத்தைத் திறக்க முடியவில்லை. வேறு படத்தை முயலவும்.", "This image could not be opened. Try another photo."],
  "errors.modelLoad": [
    "மாதிரியை ஏற்ற முடியவில்லை. இணையத்தைச் சரிபார்த்து மீண்டும் முயலவும்; கீழே கைமுறையாகத் தேர்வு செய்யலாம்.",
    "The model could not be loaded. Check your connection and try again, or choose manually below.",
  ],
  "errors.analyseFailed": ["படத்தை ஆய்வு செய்ய முடியவில்லை. மீண்டும் முயலவும்.", "The photo could not be analysed. Please try again."],
};

function setPath(obj, path, value) {
  const keys = path.split(".");
  let node = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof node[k] !== "object" || node[k] === null) node[k] = {};
    node = node[k];
  }
  const last = keys[keys.length - 1];
  if (node[last] === undefined) {
    node[last] = value;
    return true;
  }
  return false;
}

for (const [file, idx] of [["ta", 0], ["en", 1]]) {
  const p = new URL(`../src/i18n/${file}.json`, import.meta.url);
  const raw = fs.readFileSync(p, "utf8");
  const bom = raw.startsWith("﻿");
  const crlf = raw.includes("\r\n");
  const data = JSON.parse(bom ? raw.slice(1) : raw);
  let added = 0;
  for (const [k, v] of Object.entries(KEYS)) if (setPath(data, k, v[idx])) added++;
  let out = JSON.stringify(data, null, 2) + "\n";
  if (crlf) out = out.replace(/\n/g, "\r\n");
  fs.writeFileSync(p, (bom ? "﻿" : "") + out, "utf8");
  console.log(`${file}.json: added ${added} keys`);
}
