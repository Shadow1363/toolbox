/**
 * Page languages for Text Match Cut: the generated filler text plus every label the page
 * templates draw (mastheads, menus, bylines, dates). `pages.js` reads one entry as `L`.

 *
 * Adding a language: copy `en`, translate every field, add it to LANGS and LANG_OPTIONS.
 * KEY marks where the keyword goes; keep it out of spots that need an article or gender
 * agreement ("the story of KEY", not "the KEY"). All names and publications are made up.
 */
export const KEY = "\u0001";

const pick = (r, list) => list[Math.floor(r() * list.length)];
const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- English ---------- */
const EN_BANK = {
  subj: [
    "the committee",
    "local officials",
    "most observers",
    "the new report",
    "several analysts",
    "residents",
    "the organizers",
    "critics",
    "early supporters",
    "the city council",
    "researchers",
    "the team",
    "historians",
    "many fans",
    "the board",
    "visitors",
  ],
  verb: [
    "announced",
    "reviewed",
    "questioned",
    "celebrated",
    "described",
    "examined",
    "revisited",
    "outlined",
    "defended",
    "highlighted",
    "documented",
    "reconsidered",
    "praised",
    "debated",
  ],
  obj: [
    "a series of changes",
    "the long-term plan",
    "an unusual proposal",
    "the latest figures",
    "several key decisions",
    "the original agreement",
    "a broader strategy",
    "the final schedule",
    "an early draft",
    "the public response",
    "the new rules",
  ],
  pp: [
    "earlier this week",
    "after months of debate",
    "in a statement on Tuesday",
    "despite the weather",
    "for the first time in years",
    "ahead of the deadline",
    "during a brief meeting",
    "across the region",
    "by the end of the season",
    "with little warning",
    "last spring",
  ],
  adv: [
    "Meanwhile",
    "In recent years",
    "By most accounts",
    "At the same time",
    "Still",
    "For now",
    "In the end",
    "According to one estimate",
    "Not surprisingly",
    "Even so",
    "Over time",
  ],
  clause: [
    "which surprised many",
    "although details remain unclear",
    "prompting a wave of questions",
    "a move few had expected",
    "as attendance continued to grow",
    "while others urged caution",
    "raising new concerns",
    "in what some called a turning point",
  ],
  noun: [
    "history",
    "local tradition",
    "the season",
    "the economy",
    "the region",
    "popular culture",
    "the future",
    "the game",
    "public life",
    "modern media",
  ],
};
const EN_PLACES = [
  "Bramwell",
  "Kestrel Bay",
  "Ashford Vale",
  "Millbrook",
  "Cedarfield",
  "Port Halden",
  "Westmere",
  "Larkspur",
  "Dunmore Hill",
];
const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const EN_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const en = (() => {
  const B = EN_BANK;
  return {
    sentences: [
      (r) =>
        `${cap(pick(r, B.subj))} ${pick(r, B.verb)} ${pick(r, B.obj)} ${pick(r, B.pp)}.`,
      (r) =>
        `${pick(r, B.adv)}, ${pick(r, B.subj)} ${pick(r, B.verb)} ${pick(r, B.obj)}, ${pick(r, B.clause)}.`,
      (r) =>
        `${cap(pick(r, B.subj))} said the decision would shape ${pick(r, B.noun)} ${pick(r, B.pp)}.`,
      (r) =>
        `${pick(r, B.adv)}, ${pick(r, B.obj)} remains a central question for ${pick(r, B.subj)}.`,
      (r) =>
        `It was ${pick(r, B.pp)} that ${pick(r, B.subj)} ${pick(r, B.verb)} ${pick(r, B.obj)}.`,
      (r) =>
        `${cap(pick(r, B.subj))} ${pick(r, B.verb)} ${pick(r, B.obj)}, and ${pick(r, B.subj)} ${pick(r, B.verb)} ${pick(r, B.obj)}.`,
    ],
    keySentences: [
      (r) =>
        `Few moments capture attention quite like ${KEY}, ${pick(r, B.clause)}.`,
      (r) =>
        `${pick(r, B.adv)}, ${pick(r, B.subj)} ${pick(r, B.verb)} ${KEY} ${pick(r, B.pp)}.`,
      (r) => `For many people, ${KEY} has become part of ${pick(r, B.noun)}.`,
      (r) =>
        `${cap(pick(r, B.subj))} pointed to ${KEY} as ${pick(r, ["a turning point", "an example", "the main reason", "a highlight", "the main event"])} ${pick(r, B.pp)}.`,
      (r) =>
        `The story of ${KEY} began ${pick(r, ["decades ago", "long before anyone noticed", "with a simple idea", "in a small town", "almost by accident"])}.`,
      (r) =>
        `Nobody expected ${KEY} to draw so much attention ${pick(r, B.pp)}.`,
      (r) => `${pick(r, B.adv)}, the conversation kept returning to ${KEY}.`,
      (r) =>
        `Tickets for ${KEY} sold out ${pick(r, ["within hours", "in minutes", "almost immediately", "long before the doors opened"])}.`,
      (r) =>
        `Ask anyone in ${pick(r, EN_PLACES)} about ${KEY} and you will hear a different story.`,
      (r) =>
        `What made ${KEY} different was ${pick(r, ["the timing", "the crowd", "the sheer scale of it", "how quickly it spread", "the people involved"])}.`,
      (r) =>
        `${cap(pick(r, B.subj))} ${pick(r, B.verb)} the role of ${KEY}, ${pick(r, B.clause)}.`,
      (r) =>
        `By the time ${KEY} arrived, ${pick(r, B.subj)} had already ${pick(r, B.verb)} ${pick(r, B.obj)}.`,
      (r) =>
        `Even today, ${KEY} remains ${pick(r, ["a point of pride", "hard to explain", "widely debated", "a fixture of the calendar", "the main topic of conversation"])}.`,
      (r) =>
        `In the weeks before ${KEY}, ${pick(r, B.subj)} ${pick(r, B.verb)} ${pick(r, B.obj)}.`,
      (r) =>
        `Some called ${KEY} ${pick(r, ["a spectacle", "a distraction", "a once-in-a-lifetime event", "overrated", "the highlight of the year"])}; others disagreed.`,
      (r) =>
        `The first mention of ${KEY} appears in ${pick(r, ["an old letter", "a council record", "a local newspaper", "a forgotten notebook", "the town archive"])}.`,
    ],
    keyTitles: [
      `The Untold Story of ${KEY}`,
      `Why ${KEY} Still Matters`,
      `Inside ${KEY}`,
      `${KEY} Draws Record Crowds`,
      `What ${KEY} Means for Everyone`,
      `A Closer Look at ${KEY}`,
      `How ${KEY} Changed Everything`,
      `${KEY}, Explained`,
      `The Year of ${KEY}`,
      `${KEY} and the Long Road Here`,
      `Remembering ${KEY}`,
      `Everything Changed After ${KEY}`,
      `${KEY} Returns`,
    ],
    otherTitles: [
      "Council Approves New Budget",
      "Rain Expected Through the Weekend",
      "Library Marks 100 Years",
      "Markets Close Higher",
      "A Quiet Revival Downtown",
      "The Long Road Back",
      "New Bridge Opens to Traffic",
      "Students Return to Class",
      "Harvest Season Begins Early",
      "Notes From the Archive",
      "The Art of Waiting",
      "Ten Years Later",
    ],
    places: EN_PLACES,
    names: [
      "Jamie Rivera",
      "Sam Okafor",
      "Alex Morgan",
      "Priya Nair",
      "Taylor Brooks",
      "Chris Lindqvist",
      "Mara Delgado",
      "Jordan Ellis",
    ],
    number: (n) => n.toLocaleString("en-US"),
    longDate: (r) =>
      `${pick(r, EN_MONTHS)} ${int(r, 1, 28)}, ${int(r, 2015, 2025)}`,
    shortDate: (r) =>
      `${pick(r, EN_MONTHS).slice(0, 3)} ${int(r, 1, 28)}, ${int(r, 2012, 2024)}`,
    newspaper: {
      name: (r) =>
        `The ${pick(r, EN_PLACES)} ${pick(r, ["Courier", "Ledger", "Gazette", "Chronicle", "Dispatch", "Sentinel", "Record"])}`,
      dateLine: (r) =>
        `VOL. ${int(r, 40, 180)} · NO. ${int(r, 1000, 48000).toLocaleString("en-US")}      ${pick(r, EN_DAYS).toUpperCase()}, ${pick(r, EN_MONTHS).toUpperCase()} ${int(r, 1, 28)}      $${int(r, 1, 3)}.${pick(r, ["00", "50", "25"])}`,
    },
    wiki: {
      sites: ["Knowpedia", "Opencyclo", "Lexicona", "WikiAtlas Free"],
      search: (site) => `Search ${site}`,
      home: "Home",
      crumbs: ["Sports", "History", "Culture", "Events", "Society", "Media"],
      subCrumbs: ["Overview", "Topics", "Articles", "Archive"],
      from: (site) => `From ${site}, the free encyclopedia`,
      boxTitles: ["Overview", "Event details", "At a glance", "Summary"],
      boxLabels: [
        "Date",
        "Location",
        "Founded",
        "Type",
        "Attendance",
        "Organizer",
        "Region",
        "Status",
      ],
      sections: [
        "History",
        "Background",
        "Reception",
        "Legacy",
        "Overview",
        "Development",
      ],
    },
    blog: {
      names: [
        "The Quiet Notebook",
        "Field Notes Daily",
        "Morning Pages",
        "Studio Margin",
        "Small Hours Journal",
      ],
      nav: ["Home", "Essays", "Archive", "About", "Subscribe"],
      kickers: ["ESSAY", "NOTES", "CULTURE", "OPINION", "STORIES"],
      byline: (name, date, mins) => `By ${name} · ${date} · ${mins} min read`,
    },
    search: {
      logos: ["Findwell", "Quarry", "Lookwise", "Searchbox"],
      tabs: ["All", "Images", "News", "Videos", "Maps", "More"],
      results: (r) =>
        `About ${int(r, 120, 9800).toLocaleString("en-US")},000 results (0.${int(r, 21, 89)} seconds)`,
      querySuffixes: ["", " history", " meaning", " 2024", " facts"],
      domains: [
        "dailyledger-news",
        "knowpedia",
        "fieldnotes",
        "sportsdesk-weekly",
        "historyhub",
        "thecityreview",
        "eventarchive",
        "morningbrief",
      ],
      tld: ".com",
      paths: ["articles", "news", "wiki", "blog", "stories"],
      subPaths: ["2023", "feature", "guide", "archive"],
    },
    book: { chapter: "CHAPTER" },
    magazine: {
      kickers: ["FEATURE", "THE BIG STORY", "CULTURE", "PROFILE", "IN DEPTH"],
      credits: (a, b) => `Words by ${a}   ·   Photographs by ${b}`,
    },
  };
})();

/* ---------- Português (Brasil) ---------- */
// Subjects carry their number so the verb agrees: [text, plural?]; verbs are [singular, plural].
const PT_BANK = {
  subj: [
    ["a comissão", 0],
    ["as autoridades locais", 1],
    ["muitos observadores", 1],
    ["o novo relatório", 0],
    ["vários analistas", 1],
    ["os moradores", 1],
    ["os organizadores", 1],
    ["os críticos", 1],
    ["os primeiros apoiadores", 1],
    ["a câmara municipal", 0],
    ["os pesquisadores", 1],
    ["a equipe", 0],
    ["os historiadores", 1],
    ["muitos fãs", 1],
    ["o conselho", 0],
    ["os visitantes", 1],
  ],
  verb: [
    ["anunciou", "anunciaram"],
    ["revisou", "revisaram"],
    ["questionou", "questionaram"],
    ["celebrou", "celebraram"],
    ["descreveu", "descreveram"],
    ["examinou", "examinaram"],
    ["retomou", "retomaram"],
    ["apresentou", "apresentaram"],
    ["defendeu", "defenderam"],
    ["destacou", "destacaram"],
    ["documentou", "documentaram"],
    ["reconsiderou", "reconsideraram"],
    ["elogiou", "elogiaram"],
    ["debateu", "debateram"],
  ],
  obj: [
    "uma série de mudanças",
    "o plano de longo prazo",
    "uma proposta incomum",
    "os números mais recentes",
    "várias decisões importantes",
    "o acordo original",
    "uma estratégia mais ampla",
    "o cronograma final",
    "um primeiro rascunho",
    "a reação do público",
    "as novas regras",
  ],
  pp: [
    "no início desta semana",
    "após meses de debate",
    "em um comunicado na terça-feira",
    "apesar do mau tempo",
    "pela primeira vez em anos",
    "antes do prazo final",
    "durante uma breve reunião",
    "em toda a região",
    "até o fim da temporada",
    "sem muito aviso",
    "na primavera passada",
  ],
  adv: [
    "Enquanto isso",
    "Nos últimos anos",
    "Segundo a maioria dos relatos",
    "Ao mesmo tempo",
    "Ainda assim",
    "Por enquanto",
    "No fim",
    "Segundo uma estimativa",
    "Sem surpresa",
    "Mesmo assim",
    "Com o tempo",
  ],
  clause: [
    "o que surpreendeu muita gente",
    "embora os detalhes ainda não estejam claros",
    "gerando uma onda de perguntas",
    "uma decisão que poucos esperavam",
    "enquanto o público continuava a crescer",
    "enquanto outros pediam cautela",
    "levantando novas preocupações",
    "no que alguns chamaram de virada",
  ],
  noun: [
    "a história",
    "a tradição local",
    "a temporada",
    "a economia",
    "a região",
    "a cultura popular",
    "o futuro",
    "o jogo",
    "a vida pública",
    "a mídia moderna",
  ],
};
const PT_PLACES = [
  "Porto Alvorada",
  "Santa Luzia do Mar",
  "Lagoa Serena",
  "Monte Claro",
  "Vila Bela",
  "Ribeira Azul",
  "Pedra Branca",
  "Campo Verde",
  "Águas Claras",
];
const PT_MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const PT_DAYS = [
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
  "domingo",
];

const pt = (() => {
  const B = PT_BANK;
  const subj = (r) => pick(r, B.subj);
  /** Subject + agreeing verb, e.g. "os moradores celebraram". */
  const sv = (r, verbs = B.verb) => {
    const [s, pl] = subj(r);
    return `${s} ${pick(r, verbs)[pl]}`;
  };
  /** "de" + article contracts: de + a história → da história. */
  const de = (s) => s.replace(/^(a|o|as|os) /, (m, a) => `d${a} `);
  return {
    sentences: [
      (r) => `${cap(sv(r))} ${pick(r, B.obj)} ${pick(r, B.pp)}.`,
      (r) =>
        `${pick(r, B.adv)}, ${sv(r)} ${pick(r, B.obj)}, ${pick(r, B.clause)}.`,
      (r) =>
        `${cap(sv(r, [["afirmou", "afirmaram"]]))} que a decisão vai marcar ${pick(r, B.noun)} ${pick(r, B.pp)}.`,
      (r) =>
        `${pick(r, B.adv)}, ${pick(r, B.obj)} continua sendo uma questão central para ${subj(r)[0]}.`,
      (r) => `Foi ${pick(r, B.pp)} que ${sv(r)} ${pick(r, B.obj)}.`,
      (r) => `${cap(sv(r))} ${pick(r, B.obj)}, e ${sv(r)} ${pick(r, B.obj)}.`,
    ],
    keySentences: [
      (r) =>
        `Poucas coisas chamam tanta atenção quanto ${KEY}, ${pick(r, B.clause)}.`,
      (r) => `${pick(r, B.adv)}, ${sv(r)} ${KEY} ${pick(r, B.pp)}.`,
      (r) => `Para muita gente, ${KEY} já faz parte ${de(pick(r, B.noun))}.`,
      (r) =>
        `${cap(sv(r, [["apontou", "apontaram"]]))} ${KEY} como ${pick(r, ["um ponto de virada", "um exemplo", "o principal motivo", "um destaque", "o evento principal"])} ${pick(r, B.pp)}.`,
      (r) =>
        `A história de ${KEY} começou ${pick(r, ["há décadas", "muito antes de alguém perceber", "com uma ideia simples", "numa cidade pequena", "quase por acaso"])}.`,
      (r) =>
        `Ninguém esperava que ${KEY} chamasse tanta atenção ${pick(r, B.pp)}.`,
      (r) => `${pick(r, B.adv)}, a conversa sempre voltava para ${KEY}.`,
      (r) =>
        `Os ingressos para ${KEY} se esgotaram ${pick(r, ["em poucas horas", "em minutos", "quase imediatamente", "muito antes de as portas abrirem"])}.`,
      (r) =>
        `Pergunte a qualquer pessoa em ${pick(r, PT_PLACES)} sobre ${KEY} e você vai ouvir uma história diferente.`,
      (r) =>
        `O que tornou ${KEY} diferente foi ${pick(r, ["o momento", "o público", "o tamanho de tudo", "a rapidez com que se espalhou", "as pessoas envolvidas"])}.`,
      (r) => `${cap(sv(r))} o papel de ${KEY}, ${pick(r, B.clause)}.`,
      (r) => `Bem antes de ${KEY}, ${sv(r)} ${pick(r, B.obj)}.`,
      (r) =>
        `Até hoje, ${KEY} continua sendo ${pick(r, ["motivo de orgulho", "difícil de explicar", "muito debatido", "presença certa no calendário", "o principal assunto das conversas"])}.`,
      (r) => `Nas semanas antes de ${KEY}, ${sv(r)} ${pick(r, B.obj)}.`,
      (r) =>
        `Alguns chamaram ${KEY} de ${pick(r, ["um espetáculo", "uma distração", "um evento único na vida", "superestimado", "o ponto alto do ano"])}; outros discordaram.`,
      (r) =>
        `A primeira menção a ${KEY} aparece ${pick(r, ["numa carta antiga", "num registro da câmara", "num jornal local", "num caderno esquecido", "no arquivo da cidade"])}.`,
    ],
    keyTitles: [
      `A história nunca contada de ${KEY}`,
      `Por que ${KEY} ainda importa`,
      `Por dentro de ${KEY}`,
      `${KEY} bate recorde de público`,
      `O que ${KEY} significa para todos`,
      `Um olhar mais atento sobre ${KEY}`,
      `Como ${KEY} mudou tudo`,
      `${KEY}, explicado`,
      `O ano de ${KEY}`,
      `${KEY} e o longo caminho até aqui`,
      `Relembrando ${KEY}`,
      `Tudo mudou depois de ${KEY}`,
      `${KEY} está de volta`,
    ],
    otherTitles: [
      "Câmara aprova novo orçamento",
      "Chuva deve continuar no fim de semana",
      "Biblioteca completa 100 anos",
      "Bolsa fecha em alta",
      "Um renascimento discreto no centro",
      "O longo caminho de volta",
      "Nova ponte é aberta ao tráfego",
      "Alunos voltam às aulas",
      "Colheita começa mais cedo",
      "Notas do arquivo",
      "A arte de esperar",
      "Dez anos depois",
    ],
    places: PT_PLACES,
    names: [
      "Ana Ribeiro",
      "Lucas Farias",
      "Mariana Teixeira",
      "Rafael Monteiro",
      "Beatriz Almeida",
      "Thiago Moraes",
      "Camila Duarte",
      "Bruno Carvalho",
    ],
    number: (n) => n.toLocaleString("pt-BR"),
    longDate: (r) =>
      `${int(r, 1, 28)} de ${pick(r, PT_MONTHS)} de ${int(r, 2015, 2025)}`,
    shortDate: (r) =>
      `${int(r, 1, 28)} de ${pick(r, PT_MONTHS).slice(0, 3)}. de ${int(r, 2012, 2024)}`,
    newspaper: {
      name: (r) =>
        `${pick(r, ["Correio", "Gazeta", "Diário", "Tribuna", "Mensageiro", "Arauto", "Jornal"])} de ${pick(r, PT_PLACES)}`,
      dateLine: (r) =>
        `ANO ${int(r, 40, 180)} · Nº ${int(r, 1000, 48000).toLocaleString("pt-BR")}      ${pick(r, PT_DAYS).toUpperCase()}, ${int(r, 1, 28)} DE ${pick(r, PT_MONTHS).toUpperCase()}      R$ ${int(r, 1, 3)},${pick(r, ["00", "50", "25"])}`,
    },
    wiki: {
      sites: [
        "Sabepédia",
        "Enciclopédia Aberta",
        "Lexicona",
        "WikiAtlas Livre",
      ],
      search: (site) => `Pesquisar em ${site}`,
      home: "Início",
      crumbs: [
        "Esportes",
        "História",
        "Cultura",
        "Eventos",
        "Sociedade",
        "Mídia",
      ],
      subCrumbs: ["Visão geral", "Temas", "Artigos", "Arquivo"],
      from: (site) => `Origem: ${site}, a enciclopédia livre`,
      boxTitles: ["Visão geral", "Detalhes do evento", "Em resumo", "Resumo"],
      boxLabels: [
        "Data",
        "Local",
        "Fundação",
        "Tipo",
        "Público",
        "Organização",
        "Região",
        "Situação",
      ],
      sections: [
        "História",
        "Contexto",
        "Recepção",
        "Legado",
        "Visão geral",
        "Desenvolvimento",
      ],
    },
    blog: {
      names: [
        "Caderno Silencioso",
        "Notas de Campo",
        "Páginas da Manhã",
        "Margem do Ateliê",
        "Diário da Madrugada",
      ],
      nav: ["Início", "Ensaios", "Arquivo", "Sobre", "Assinar"],
      kickers: ["ENSAIO", "NOTAS", "CULTURA", "OPINIÃO", "HISTÓRIAS"],
      byline: (name, date, mins) =>
        `Por ${name} · ${date} · ${mins} min de leitura`,
    },
    search: {
      logos: ["Achatudo", "Buscalá", "Olhaí", "Lupinha"],
      tabs: ["Tudo", "Imagens", "Notícias", "Vídeos", "Mapas", "Mais"],
      results: (r) =>
        `Aproximadamente ${int(r, 120, 9800).toLocaleString("pt-BR")}.000 resultados (0,${int(r, 21, 89)} segundos)`,
      querySuffixes: [
        "",
        " história",
        " significado",
        " 2024",
        " curiosidades",
      ],
      domains: [
        "gazeta-local",
        "sabepedia",
        "notasdecampo",
        "esporte-semanal",
        "historiaviva",
        "revistadacidade",
        "arquivodeeventos",
        "resumodamanha",
      ],
      tld: ".com.br",
      paths: ["artigos", "noticias", "wiki", "blog", "historias"],
      subPaths: ["2023", "especial", "guia", "arquivo"],
    },
    book: { chapter: "CAPÍTULO" },
    magazine: {
      kickers: [
        "ESPECIAL",
        "A GRANDE HISTÓRIA",
        "CULTURA",
        "PERFIL",
        "EM PROFUNDIDADE",
      ],
      credits: (a, b) => `Texto de ${a}   ·   Fotos de ${b}`,
    },
  };
})();

export const LANGS = { en, pt };
export const LANG_OPTIONS = [
  ["en", "English"],
  ["pt", "Português"],
];
