from typing import Optional, Tuple

SUBJECT_KEYWORDS = {
    "mathematics": [
        "maths", "math", "mathematics", "algebra", "geometry", "trigonometry",
        "quadratic", "simultaneous", "logarithm", "log ", "indices", "statistics",
        "probability", "calculus", "differentiation", "integration", "matrix",
        "matrices", "vector", "sequence", "series", "permutation", "combination",
        "binomial", "number base", "binary", "gradient", "circle theorem",
        "cycle theorem", "mensuration", "coordinate", "locus",
    ],
    "physics": [
        "physics", "force", "motion", "velocity", "acceleration", "newton",
        "energy", "work", "power", "momentum", "wave", "waves", "light",
        "optics", "electricity", "circuit", "voltage", "current", "resistance",
        "heat", "temperature", "pressure", "projectile", "friction", "nuclear",
        "magnetic", "suvat", "equations of motion",
    ],
    "chemistry": [
        "chemistry", "atom", "molecule", "element", "compound", "ionic bond",
        "covalent bond", "bonding", "periodic table", "acid", "base", "salt",
        "mole", "titration", "electrolysis", "organic chemistry", "alkane",
        "alkene", "functional group", "isotope", "electron", "reaction",
    ],
    "biology": [
        "biology", "cell", "tissue", "organ", "photosynthesis", "respiration",
        "skeleton", "joint", "blood", "heart", "kidney", "reproduction",
        "genetics", "ecology", "evolution", "nutrition", "excretion",
        "hormone", "dna", "chromosome", "mitosis", "meiosis", "enzyme",
    ],
    "english": [
        "english", "grammar", "comprehension", "essay", "vocabulary",
        "spelling", "punctuation", "tense", "verb", "noun", "pronoun",
        "sentence", "summary", "poetry", "poem", "prose", "novel", "drama",
        "oral english", "phonetics", "stress pattern", "concord",
        "reported speech", "active voice", "passive voice",
    ],
    "economics": [
        "economics", "demand", "supply", "market", "price", "inflation",
        "gdp", "national income", "trade", "banking", "elasticity",
        "production", "cost", "revenue", "opportunity cost",
    ],
    "government": [
        "government", "constitution", "democracy", "election", "parliament",
        "legislature", "executive", "judiciary", "federalism", "citizenship",
        "human rights", "political party", "sovereignty", "inec",
    ],
    "literature": [
        "literature", "things fall apart", "achebe", "soyinka", "adichie",
        "novel", "drama", "poetry", "characterization", "theme", "plot",
        "metaphor", "simile", "symbolism",
    ],
    "further_mathematics": [
        "further maths", "further mathematics", "complex number",
        "partial fraction", "polynomial", "vector 3d", "mechanics",
    ],
    "geography": [
        "geography", "latitude", "longitude", "climate", "vegetation",
        "population", "mining", "agriculture nigeria", "erosion",
        "relief", "plateau", "valley",
    ],
    "accounting": [
        "accounting", "balance sheet", "profit and loss", "trial balance",
        "ledger", "journal", "depreciation", "assets", "liabilities",
    ],
    "commerce": [
        "commerce", "trade", "insurance", "banking", "transport",
        "warehousing", "communication", "home trade", "foreign trade",
    ],
    "agricultural_science": [
        "agriculture", "farming", "crops", "livestock", "soil", "fertilizer",
        "irrigation", "pest", "weed", "agronomy",
    ],
}

TOPIC_KEYWORDS = {
    "circle theorems": ["circle theorem", "cycle theorem", "cyclic quadrilateral", "inscribed angle", "tangent circle", "chord", "alternate segment"],
    "quadratic equations": ["quadratic", "completing the square", "quadratic formula", "discriminant"],
    "logarithms": ["logarithm", "log ", "antilog", "log table", "ln "],
    "simultaneous equations": ["simultaneous", "two unknowns", "elimination method", "substitution method"],
    "differentiation": ["differentiate", "differentiation", "dy/dx", "turning point", "gradient function"],
    "integration": ["integrate", "integration", "area under curve", "definite integral"],
    "matrices": ["matrix", "matrices", "determinant", "inverse matrix"],
    "trigonometry": ["sohcahtoa", "sine rule", "cosine rule", "trigonometry", "angle of elevation"],
    "statistics": ["mean", "median", "mode", "standard deviation", "variance", "frequency table", "histogram"],
    "number bases": ["binary", "base 2", "number base", "base 8", "octal"],
    "equations of motion": ["suvat", "equations of motion", "uniform acceleration"],
    "electricity": ["ohm's law", "series circuit", "parallel circuit", "resistance", "voltage current"],
    "waves": ["wave equation", "frequency wavelength", "transverse longitudinal"],
    "ionic bonding": ["ionic bond", "ionic bonding", "electron transfer"],
    "covalent bonding": ["covalent bond", "covalent bonding", "electron sharing"],
    "atomic structure": ["proton neutron electron", "atomic number", "mass number", "electron configuration"],
    "photosynthesis": ["photosynthesis", "chlorophyll", "light reaction", "dark reaction"],
    "genetics": ["genotype", "phenotype", "punnett", "dominant", "recessive", "mendel"],
    "kidney excretion": ["nephron", "kidney", "ultrafiltration", "urine formation"],
    "concord": ["concord", "subject verb agreement", "neither either"],
    "reported speech": ["reported speech", "indirect speech", "backshift"],
    "acids bases": ["acid base", "ph scale", "neutralization", "indicator"],
    "mole concept": ["mole", "molar mass", "avogadro"],
}

TOPIC_TO_SUBJECT = {
    "circle theorems": "mathematics",
    "quadratic equations": "mathematics",
    "logarithms": "mathematics",
    "simultaneous equations": "mathematics",
    "differentiation": "mathematics",
    "integration": "mathematics",
    "matrices": "mathematics",
    "trigonometry": "mathematics",
    "statistics": "mathematics",
    "number bases": "mathematics",
    "equations of motion": "physics",
    "electricity": "physics",
    "waves": "physics",
    "ionic bonding": "chemistry",
    "covalent bonding": "chemistry",
    "atomic structure": "chemistry",
    "acids bases": "chemistry",
    "mole concept": "chemistry",
    "photosynthesis": "biology",
    "genetics": "biology",
    "kidney excretion": "biology",
    "concord": "english",
    "reported speech": "english",
}

def detect_subject_and_topic(message: str) -> Tuple[Optional[str], Optional[str]]:
    msg = message.lower()

    detected_topic = None
    for topic, keywords in TOPIC_KEYWORDS.items():
        if any(kw in msg for kw in keywords):
            detected_topic = topic
            break

    detected_subject = None
    for subject, keywords in SUBJECT_KEYWORDS.items():
        if any(kw in msg for kw in keywords):
            detected_subject = subject
            break

    if detected_topic and not detected_subject:
        detected_subject = TOPIC_TO_SUBJECT.get(detected_topic)

    return detected_subject, detected_topic
