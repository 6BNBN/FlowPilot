/**
 * @module infrastructure/lang-analyzers
 * @description 多语言文本分析 - 停用词过滤、英语词干提取、语言检测
 */

/** 停用词表（每种语言高频词） */
const STOP_WORDS: Record<string, Set<string>> = {
  en: new Set(['the','is','at','which','on','a','an','and','or','but','in','of','to','for','with','that','this','it','be','as','are','was','were','been','being','have','has','had','do','does','did','will','would','shall','should','may','might','can','could','not','no','nor','so','if','then','than','too','very','just','about','above','after','before','between','into','through','during','from','up','down','out','off','over','under','again','further','once','here','there','when','where','why','how','all','each','every','both','few','more','most','other','some','such','only','own','same','also','by','i','me','my','we','our','you','your','he','him','his','she','her','they','them','their','its','what','who','whom']),
  zh: new Set(['的','了','在','是','我','有','和','就','不','都','而','及','与','这','那','你','他','她','它','们','会','能','要','也','很','把','被','让','给','从','到','对','说','去','来','做','可以','没有','因为','所以','如果','但是','虽然','已经','还是','或者','以及','关于']),
  ja: new Set(['の','に','は','を','た','が','で','て','と','し','れ','さ','ある','いる','も','する','から','な','こと','よう','ない','なる','お','ます','です','だ','その','この','それ','これ','あの','どの','へ','より','まで','ため']),
  ko: new Set(['의','가','이','은','는','을','를','에','와','과','도','로','으로','에서','까지','부터','만','보다','처럼','같이','하다','있다','되다','없다','않다','그','이','저','것','수','등','때']),
  fr: new Set(['le','la','les','de','des','un','une','et','en','du','au','aux','ce','ces','que','qui','ne','pas','par','pour','sur','avec','dans','est','sont','a','ont','il','elle','nous','vous','ils','elles','se','son','sa','ses','leur','leurs','mais','ou','donc','car','ni']),
  de: new Set(['der','die','das','ein','eine','und','in','von','zu','mit','auf','für','an','bei','nach','über','vor','aus','wie','als','oder','aber','wenn','auch','noch','nur','nicht','ist','sind','hat','haben','wird','werden','ich','du','er','sie','es','wir','ihr']),
  es: new Set(['el','la','los','las','de','en','un','una','y','que','del','al','es','por','con','no','se','su','para','como','más','pero','sus','le','ya','o','fue','ha','son','está','muy','también','desde','todo','nos','cuando','entre','sin','sobre','ser','tiene']),
  pt: new Set(['o','a','os','as','de','em','um','uma','e','que','do','da','dos','das','no','na','nos','nas','por','para','com','não','se','seu','sua','mais','mas','como','foi','são','está','tem','já','ou','ser','ter','muito','também','ao','aos','pela','pelo']),
  ru: new Set(['и','в','не','на','я','что','он','с','это','а','как','но','она','они','мы','вы','все','его','её','их','от','по','за','для','из','до','так','же','то','бы','было','быть','уже','ещё','или','ни','нет','да','есть','был','была','были']),
  ar: new Set(['في','من','على','إلى','أن','هذا','التي','الذي','هو','هي','ما','لا','كان','عن','مع','هذه','كل','بين','قد','ذلك','بعد','عند','لم','أو','حتى','إذا','ثم','أي','قبل','فقط','منذ','أنه','لكن','نحن','هم','أنا','كانت']),
};

/** 英语 Porter Stemmer（轻量版：覆盖最常见后缀） */
export function stem(word: string): string {
  if (word.length < 4) return word;
  let w = word;
  // Step 1: 常见后缀
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'i';
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ness')) w = w.slice(0, -4);
  else if (w.endsWith('ment')) w = w.slice(0, -4);
  else if (w.endsWith('ingly')) w = w.slice(0, -5);
  else if (w.endsWith('edly')) w = w.slice(0, -4);
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('tion')) w = w.slice(0, -3) + 't';
  else if (w.endsWith('sion')) w = w.slice(0, -3) + 's';
  else if (w.endsWith('ful')) w = w.slice(0, -3);
  else if (w.endsWith('ous')) w = w.slice(0, -3);
  else if (w.endsWith('ive')) w = w.slice(0, -3);
  else if (w.endsWith('able')) w = w.slice(0, -4);
  else if (w.endsWith('ible')) w = w.slice(0, -4);
  else if (w.endsWith('ally')) w = w.slice(0, -4) + 'al';
  else if (w.endsWith('ly') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('er') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
  // Step 2: 二级后缀
  if (w.endsWith('ational')) w = w.slice(0, -7) + 'ate';
  else if (w.endsWith('izer')) w = w.slice(0, -1);
  else if (w.endsWith('fulness')) w = w.slice(0, -4);
  return w.length >= 2 ? w : word;
}

/** 判断码点是否为平假名/片假名 */
function isJapaneseKana(cp: number): boolean {
  return (cp >= 0x3040 && cp <= 0x309F) || (cp >= 0x30A0 && cp <= 0x30FF);
}

/** 判断码点是否为韩文 Hangul */
function isHangul(cp: number): boolean {
  return (cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0x1100 && cp <= 0x11FF);
}

/** 判断码点是否为 CJK 汉字 */
function isCJKIdeograph(cp: number): boolean {
  return (cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF)
    || (cp >= 0x20000 && cp <= 0x2A6DF) || (cp >= 0xF900 && cp <= 0xFAFF);
}

/** 判断码点是否为西里尔字母 */
function isCyrillic(cp: number): boolean {
  return (cp >= 0x0400 && cp <= 0x04FF);
}

/** 判断码点是否为阿拉伯字母 */
function isArabic(cp: number): boolean {
  return (cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0x0750 && cp <= 0x077F);
}

/** 拉丁语系特征词检测 */
const LATIN_LANG_MARKERS: [string, RegExp][] = [
  ['fr', /\b(le|la|les|des|une|est|dans|pour|avec|sont|nous|vous|cette|aussi|mais|comme|très|être|avoir|fait|tout|quel|cette|ces|aux|sur|par|qui|que)\b/gi],
  ['de', /\b(der|die|das|ein|eine|und|ist|sind|nicht|auf|für|mit|auch|noch|nur|oder|aber|wenn|wird|haben|über|nach|vor|aus|wie|als|ich|wir|ihr)\b/gi],
  ['es', /\b(el|los|las|una|del|por|con|para|como|más|pero|fue|está|muy|también|desde|todo|cuando|entre|sin|sobre|tiene|puede|hay|ser|este|esta|estos)\b/gi],
  ['pt', /\b(os|uma|das|dos|pela|pelo|para|com|não|mais|mas|como|foi|são|está|tem|muito|também|seu|sua|nos|nas|quando|entre|desde|pode|ser|ter|este|esta)\b/gi],
];

/**
 * 语言检测（扩展版）
 * 返回 ISO 639-1 语言代码：en, zh, ja, ko, fr, de, es, pt, ru, ar
 */
export function detectLanguage(text: string): string {
  const sample = text.slice(0, 500);
  if (!sample.trim()) return 'en';

  let kana = 0, hangul = 0, cjk = 0, cyrillic = 0, arabic = 0, latin = 0, total = 0;
  for (const ch of sample) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x20) continue;
    total++;
    if (isJapaneseKana(cp)) kana++;
    else if (isHangul(cp)) hangul++;
    else if (isCJKIdeograph(cp)) cjk++;
    else if (isCyrillic(cp)) cyrillic++;
    else if (isArabic(cp)) arabic++;
    else if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A) || (cp >= 0xC0 && cp <= 0x024F)) latin++;
  }
  if (total === 0) return 'en';

  // 非拉丁文字检测
  if (kana / total > 0.1) return 'ja';
  if (hangul / total > 0.1) return 'ko';
  if (cjk / total > 0.15) return 'zh';
  if (cyrillic / total > 0.15) return 'ru';
  if (arabic / total > 0.15) return 'ar';

  // 拉丁语系：用特征词匹配
  if (latin / total > 0.4) {
    let bestLang = 'en', bestScore = 0;
    for (const [lang, re] of LATIN_LANG_MARKERS) {
      const matches = sample.match(re);
      const score = matches ? matches.length : 0;
      if (score > bestScore) { bestScore = score; bestLang = lang; }
    }
    // 需要至少 3 个特征词才判定为非英语
    return bestScore >= 3 ? bestLang : 'en';
  }

  return 'en';
}

/** 停用词过滤 */
export function removeStopWords(tokens: string[], lang: string): string[] {
  const stops = STOP_WORDS[lang];
  if (!stops) return tokens;
  return tokens.filter(t => !stops.has(t));
}

/** 统一分析管线：语言检测 → 分词（由调用方完成）→ 停用词过滤 → 词干提取（仅英语） */
export function analyze(tokens: string[], lang?: string): { tokens: string[]; lang: string } {
  const detectedLang = lang ?? 'en';
  let result = removeStopWords(tokens, detectedLang);
  if (detectedLang === 'en') result = result.map(stem);
  return { tokens: result, lang: detectedLang };
}
