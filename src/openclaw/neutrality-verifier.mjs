const STOP = new Set(['what','which','who','where','when','how','czy','co','jaki','jaka','jakie','gdzie','kiedy','the','a','an','and','or','of','to','in','on','at','is','are','was','were','be','been','with','for','from','this','that','it','as','i','you','he','she','they','we','czy','i','oraz','lub','do','w','na','z','ze','jest','są','to','ten','ta','te','jak','jaki','jaka']);
const SAFE = new Set([
  'target','cel','subject','osoba','viewer','field','pole','signal','sygnał','describe','opisz','explore','zbadaj','check','sprawdź','center','centrum','surroundings','otoczenie','activity','aktywność','movement','ruch','direction','kierunek','relationship','relationships','relacja','relacje','emotion','emotions','emocja','emocje','feeling','feelings','odczucie','odczucia','thought','thoughts','myśl','myśli','state','stan','condition','kondycja','body','ciało','awareness','świadomość','time','czas','before','after','przed','po','more','więcej','detail','details','szczegół','szczegóły','main','główny','główna','aspect','aspekt','context','kontekst','environment','otoczenie','people','ludzie','others','inni','risk','ryzyko','trust','zaufanie','engagement','zaangażowanie','question','pytanie','raw','dane'
]);
function tokenList(text) { return String(text).toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{3,}/gu)?.filter((x)=>!STOP.has(x)) ?? []; }
export function strictBlindNeutralityVerifier(instruction, blindContext = {}) {
  const tokens = tokenList(instruction);
  if (!tokens.length) return 'UNCERTAIN';
  const known = new Set();
  for (const row of blindContext.accepted_results ?? []) for (const t of tokenList(row.result_text)) known.add(t);
  for (const token of tokens) if (!SAFE.has(token) && !known.has(token)) return 'UNCERTAIN';
  return 'NEUTRAL';
}
