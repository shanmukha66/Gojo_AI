export type FirstAidTip = { title: string; detail: string };

type Tip = { keywords: string[]; title: string; detail: string };

const tips: Tip[] = [
  {
    keywords: ["fever", "flu", "temperature", "chills", "body pain", "body ache"],
    title: "Fever care",
    detail:
      "Rest, drink fluids, and monitor temperature. Seek care if fever is very high, breathing becomes difficult, confusion occurs, rash appears, or it lasts more than 3 days.",
  },
  {
    keywords: ["cut", "bleeding", "wound", "laceration"],
    title: "Minor cuts",
    detail:
      "Rinse with clean water, apply gentle pressure to stop bleeding, then cover with a clean bandage. Seek urgent care if bleeding does not stop or the wound is deep.",
  },
  {
    keywords: ["burn", "hot", "scald", "blister"],
    title: "Minor burns",
    detail:
      "Cool the area under running water for 10 to 20 minutes. Do not apply ice or butter. Seek care if the burn is large, deep, or on the face.",
  },
  {
    keywords: ["sprain", "strain", "twist", "ankle"],
    title: "Sprains",
    detail:
      "Rest the area, apply ice wrapped in cloth, compress gently, and elevate. Seek care if swelling is severe, weight-bearing is difficult, numbness occurs, or pain persists.",
  },
  {
    keywords: ["headache", "head ache", "migraine", "migraines"],
    title: "Headache or migraine support",
    detail:
      "Rest in a quiet/dim room, hydrate, avoid known triggers, and consider discussing frequent migraines with a clinician. Seek urgent care for sudden worst headache, weakness, confusion, fever with stiff neck, vision loss, head injury, or new severe headache.",
  },
  {
    keywords: ["heart", "chest", "chest pain", "heart pain", "pressure", "left arm", "shortness of breath", "breathing", "sweating"],
    title: "Chest or heart symptoms",
    detail:
      "Chest pain, heart discomfort, pressure, shortness of breath, sweating, nausea, fainting, or pain spreading to the arm/jaw/back can be serious. Stop activity, sit upright, avoid driving yourself, and seek urgent/emergency care immediately if symptoms are new, worsening, severe, or unusual.",
  },
  {
    keywords: ["sore throat", "throat pain", "throat", "cough", "cold"],
    title: "Sore throat and cough",
    detail:
      "Warm fluids, rest, and salt-water gargles may help. Seek care if breathing is difficult, swallowing becomes hard, fever is high, symptoms worsen, or chest pain occurs.",
  },
  {
    keywords: ["nausea", "vomit", "vomiting", "stomach"],
    title: "Nausea",
    detail:
      "Take small sips of fluid and bland foods. Seek care if vomiting is persistent, severe, bloody, or accompanied by dehydration, severe pain, or fainting.",
  },
  {
    keywords: ["diarrhea"],
    title: "Diarrhea",
    detail:
      "Hydrate with water or oral rehydration solution and avoid greasy food. Seek care if it is severe, prolonged, or associated with fainting, blood, high fever, or dehydration.",
  },
  {
    keywords: ["rash", "itching", "hives"],
    title: "Rash or hives",
    detail:
      "Avoid scratching and note any new foods, medicines, or exposures. Seek urgent care for swelling of lips/face, trouble breathing, severe rash, fever, or rapidly spreading symptoms.",
  },
  {
    keywords: ["first aid", "firstaid", "help", "what to do"],
    title: "First-aid basics",
    detail: "Focus on safety first, control bleeding, cool burns, hydrate when appropriate, and seek help for severe symptoms or signs of emergency.",
  },
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s\-_/]+/g, "").trim();
}

export async function getFirstAidAnswer(query: string) {
  const rawQuery = query.toLowerCase().trim();
  const compactQuery = normalize(rawQuery);

  if (!rawQuery) {
    return {
      tips: tips.slice(0, 3),
      source: "local_first_aid_knowledge",
      fallback: true,
      dataset: { loaded: false, error: null as string | null },
      cautionLevel: "low" as const,
      escalationNote: "If symptoms feel severe, sudden, or dangerous, seek urgent medical attention.",
    };
  }

  const matches = tips.filter((tip) =>
    tip.keywords.some((keyword) => {
      const item = keyword.toLowerCase().trim();
      return rawQuery.includes(item) || compactQuery.includes(normalize(item));
    }),
  );

  if (matches.length) {
    return {
      tips: matches,
      source: "local_first_aid_knowledge",
      fallback: false,
      dataset: { loaded: false, error: null as string | null },
      cautionLevel: matches.some((tip) => /urgent|severe|breathing|confusion|weakness/i.test(tip.detail)) ? ("moderate" as const) : ("low" as const),
      escalationNote: "Use this as basic first-aid guidance. Seek urgent care if symptoms are severe, sudden, unusual, or rapidly worsening.",
    };
  }

  return {
    tips: tips.slice(0, 3),
    source: "local_first_aid_knowledge",
    fallback: true,
    dataset: { loaded: false, error: null as string | null },
    cautionLevel: "moderate" as const,
    escalationNote: "No strong local first-aid match was found. If symptoms are worrying or worsening, contact a healthcare professional.",
  };
}
