/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * NIGERIAN CURRICULUM DATA — WAEC, NECO, JAMB Alignment
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This module provides structured curriculum data for Nigerian secondary
 * education. It enables the AI to align responses to official syllabi,
 * reference past question patterns, and provide grade-appropriate content.
 *
 * All data is organized by:
 * - Subject (Mathematics, Physics, Chemistry, etc.)
 * - Topic (with WAEC/NECO/JAMB syllabus codes)
 * - Grade level (SS1, SS2, SS3, JSS)
 * - Exam type (WAEC, NECO, JAMB, Junior WAEC)
 * - Common question patterns
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { NigerianCurriculum, CurriculumTopic } from '../utils/types';

// ───────────────────────────────────────────────────────────────────────────────
// MATHEMATICS CURRICULUM
// ───────────────────────────────────────────────────────────────────────────────

const mathematicsTopics: CurriculumTopic[] = [
  {
    name: 'Number Systems & Bases',
    code: 'MTH-001',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS1', 'SS2'],
    prerequisites: [],
    subtopics: [
      'Conversion between bases (2, 8, 10, 16)',
      'Binary arithmetic',
      'Modular arithmetic',
      'Fractions, decimals, percentages',
    ],
    commonQuestionTypes: [
      'Convert 1101₂ to base 10',
      'Evaluate 23₄ + 32₄',
      'Find the value of x in 2x ≡ 1 (mod 5)',
    ],
    estimatedStudyHours: 8,
  },
  {
    name: 'Algebraic Expressions & Equations',
    code: 'MTH-002',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS1', 'SS2', 'SS3'],
    prerequisites: ['MTH-001'],
    subtopics: [
      'Simplification of algebraic fractions',
      'Factorization (linear, quadratic)',
      'Simultaneous equations (2 and 3 variables)',
      'Quadratic equations (formula, completing square)',
      'Inequalities',
    ],
    commonQuestionTypes: [
      'Solve: 2x² - 5x + 3 = 0',
      'Solve simultaneously: 3x + 2y = 12, x - y = 1',
      'Factorize completely: x³ - 8',
    ],
    estimatedStudyHours: 15,
  },
  {
    name: 'Trigonometry',
    code: 'MTH-003',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['MTH-002'],
    subtopics: [
      'Trigonometric ratios (SOH CAH TOA)',
      'Sine and cosine rules',
      'Area of triangles using trig',
      'Bearings and distances',
      'Angles of elevation and depression',
      'Graphs of sin, cos, tan',
    ],
    commonQuestionTypes: [
      'A ladder 10m long leans against a wall at 60°. Find the height.',
      'From point A, the bearing of B is 075°. Find the back bearing.',
      'Solve: sin(2x) = 0.5 for 0° ≤ x ≤ 360°',
    ],
    estimatedStudyHours: 12,
  },
  {
    name: 'Calculus — Differentiation',
    code: 'MTH-004',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS3'],
    prerequisites: ['MTH-002', 'MTH-003'],
    subtopics: [
      'Limits and continuity',
      'Differentiation from first principles',
      'Power rule, product rule, quotient rule, chain rule',
      'Differentiation of trig, exponential, logarithmic functions',
      'Applications: maxima, minima, rates of change',
    ],
    commonQuestionTypes: [
      'Differentiate y = x³ + 2x² - 5x + 1',
      'Find the stationary points of y = x³ - 6x² + 9x',
      'A square sheet of metal... find max volume (optimization)',
    ],
    estimatedStudyHours: 18,
  },
  {
    name: 'Calculus — Integration',
    code: 'MTH-005',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS3'],
    prerequisites: ['MTH-004'],
    subtopics: [
      'Indefinite integration (reverse of differentiation)',
      'Integration of polynomials, trig, exponential',
      'Definite integration',
      'Area under curves',
      'Volume of revolution',
    ],
    commonQuestionTypes: [
      '∫(3x² + 4x - 2) dx',
      'Find the area bounded by y = x² and y = 4',
      'Evaluate ∫₀^(π/2) sin(x) dx',
    ],
    estimatedStudyHours: 15,
  },
  {
    name: 'Statistics & Probability',
    code: 'MTH-006',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['MTH-001'],
    subtopics: [
      'Data representation (tables, graphs)',
      'Measures of central tendency (mean, median, mode)',
      'Measures of dispersion (range, variance, SD)',
      'Permutations and combinations',
      'Probability theory',
      'Binomial distribution',
    ],
    commonQuestionTypes: [
      'Calculate the mean and standard deviation of: 5, 8, 12, 15, 20',
      'In how many ways can 6 people sit in a row?',
      'A bag contains 3 red and 5 blue balls. P(red) = ?',
    ],
    estimatedStudyHours: 14,
  },
  {
    name: 'Circle Theorem',
    code: 'MTH-007',
    examTypes: ['WAEC', 'NECO'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['MTH-003'],
    subtopics: [
      'Angle at center = 2 × angle at circumference',
      'Angles in same segment',
      'Angle in semicircle = 90°',
      'Opposite angles of cyclic quadrilateral',
      'Tangent properties',
    ],
    commonQuestionTypes: [
      'In a circle with center O, angle AOB = 80°. Find angle ACB.',
      'AB is a diameter. C is on circumference. Find angle ACB.',
      'Prove that angle A + angle C = 180° in cyclic quad ABCD.',
    ],
    estimatedStudyHours: 10,
  },
  {
    name: 'Matrices & Determinants',
    code: 'MTH-008',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS3'],
    prerequisites: ['MTH-002'],
    subtopics: [
      'Matrix operations (addition, multiplication)',
      'Determinants (2×2, 3×3)',
      'Inverse matrices',
      'Solving simultaneous equations using matrices',
      'Transformation matrices',
    ],
    commonQuestionTypes: [
      'Find the determinant of |3 2| |1 4|',
      'If A = [[2,1],[3,4]], find A⁻¹',
      'Use matrices to solve: 2x + 3y = 8, x - y = 1',
    ],
    estimatedStudyHours: 10,
  },
  {
    name: 'Vectors',
    code: 'MTH-009',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS3'],
    prerequisites: ['MTH-003'],
    subtopics: [
      'Vector representation (magnitude, direction)',
      'Vector addition and subtraction',
      'Scalar product (dot product)',
      'Vector equations of lines',
      'Position vectors',
    ],
    commonQuestionTypes: [
      'Find the magnitude of vector a = 3i + 4j',
      'If a = (2,3) and b = (1,-2), find a + b',
      'Find the angle between a = i + j and b = i - j',
    ],
    estimatedStudyHours: 10,
  },
  {
    name: 'Sequences & Series',
    code: 'MTH-010',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['MTH-002'],
    subtopics: [
      'Arithmetic progression (AP)',
      'Geometric progression (GP)',
      'nth term formulas',
      'Sum formulas',
      'Convergence of GP',
    ],
    commonQuestionTypes: [
      'Find the 20th term of: 3, 7, 11, 15, ...',
      'Sum to infinity: 8 + 4 + 2 + 1 + ...',
      'The 3rd term of GP is 12, 6th term is 96. Find the first term.',
    ],
    estimatedStudyHours: 10,
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// PHYSICS CURRICULUM
// ───────────────────────────────────────────────────────────────────────────────

const physicsTopics: CurriculumTopic[] = [
  {
    name: 'Mechanics — Kinematics',
    code: 'PHY-001',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS1', 'SS2'],
    prerequisites: [],
    subtopics: [
      'Distance, displacement, speed, velocity, acceleration',
      'Equations of motion (suvat)',
      'Graphs of motion',
      'Free fall and projectiles',
    ],
    commonQuestionTypes: [
      'A car accelerates from 10 m/s to 30 m/s in 5s. Find acceleration.',
      'A ball is thrown upward at 20 m/s. Find max height.',
      'From a velocity-time graph, find the distance traveled.',
    ],
    estimatedStudyHours: 12,
  },
  {
    name: 'Mechanics — Dynamics',
    code: 'PHY-002',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS1', 'SS2'],
    prerequisites: ['PHY-001'],
    subtopics: [
      "Newton's laws of motion",
      'Force, mass, acceleration (F = ma)',
      'Friction (static, kinetic)',
      'Work, energy, power',
      'Conservation of energy',
      'Momentum and impulse',
      'Collisions (elastic, inelastic)',
    ],
    commonQuestionTypes: [
      'A 5kg mass is acted on by 20N force. Find acceleration.',
      'A 2kg ball moving at 3m/s collides with a wall. Find impulse.',
      'Calculate the work done lifting a 10kg mass 5m high.',
    ],
    estimatedStudyHours: 15,
  },
  {
    name: 'Electricity',
    code: 'PHY-003',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['PHY-002'],
    subtopics: [
      "Ohm's law",
      'Series and parallel circuits',
      'Resistivity',
      'Electrical power and energy',
      'Kirchhoff\'s laws',
      'Potentiometer and Wheatstone bridge',
    ],
    commonQuestionTypes: [
      'Three resistors (2Ω, 4Ω, 6Ω) in series. Find total R.',
      'A 60W bulb operates at 240V. Find the current.',
      'Using Kirchhoff\'s laws, find currents in the circuit.',
    ],
    estimatedStudyHours: 15,
  },
  {
    name: 'Optics',
    code: 'PHY-004',
    examTypes: ['WAEC', 'NECO'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['PHY-001'],
    subtopics: [
      'Reflection (plane mirrors, curved mirrors)',
      'Refraction (Snell\'s law)',
      'Lenses (convex, concave)',
      'Lens formula: 1/f = 1/u + 1/v',
      'Magnification',
      'Dispersion of light',
    ],
    commonQuestionTypes: [
      'An object is placed 15cm from a convex lens of focal length 10cm. Find image position.',
      'Light travels from air to water (n = 1.33) at 40°. Find angle of refraction.',
      'A concave mirror has f = 20cm. Where should object be placed for real image?',
    ],
    estimatedStudyHours: 12,
  },
  {
    name: 'Modern Physics',
    code: 'PHY-005',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS3'],
    prerequisites: ['PHY-003'],
    subtopics: [
      'Photoelectric effect',
      'Bohr model of the atom',
      'Radioactivity (α, β, γ)',
      'Half-life calculations',
      'Nuclear fission and fusion',
      'Einstein\'s mass-energy equivalence (E = mc²)',
    ],
    commonQuestionTypes: [
      'Calculate the energy of a photon with frequency 5×10¹⁴ Hz.',
      'A radioactive substance has half-life 10 days. After 30 days, what fraction remains?',
      'Calculate energy released when 1kg of mass is converted.',
    ],
    estimatedStudyHours: 12,
  },
  {
    name: 'Waves',
    code: 'PHY-006',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['PHY-001'],
    subtopics: [
      'Types of waves (transverse, longitudinal)',
      'Wave equation: v = fλ',
      'Properties (reflection, refraction, diffraction, interference)',
      'Stationary waves',
      'Sound waves (pitch, loudness, quality)',
      'Doppler effect',
    ],
    commonQuestionTypes: [
      'A wave has frequency 50Hz and wavelength 2m. Find speed.',
      'Two waves interfere. Explain constructive and destructive.',
      'Explain why sound travels faster in solids than gases.',
    ],
    estimatedStudyHours: 10,
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// CHEMISTRY CURRICULUM
// ───────────────────────────────────────────────────────────────────────────────

const chemistryTopics: CurriculumTopic[] = [
  {
    name: 'Atomic Structure',
    code: 'CHM-001',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS1', 'SS2'],
    prerequisites: [],
    subtopics: [
      'Subatomic particles (protons, neutrons, electrons)',
      'Atomic number and mass number',
      'Isotopes',
      'Electron configuration',
      'Bohr model',
      'Periodic table trends',
    ],
    commonQuestionTypes: [
      'An atom has 17 protons and 18 neutrons. Find atomic number and mass number.',
      'Write the electron configuration of chlorine (Z=17).',
      'Explain why atomic radius decreases across a period.',
    ],
    estimatedStudyHours: 10,
  },
  {
    name: 'Chemical Bonding',
    code: 'CHM-002',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS1', 'SS2'],
    prerequisites: ['CHM-001'],
    subtopics: [
      'Ionic bonding',
      'Covalent bonding (single, double, triple)',
      'Metallic bonding',
      'Intermolecular forces',
      'Hydrogen bonding',
      'Shapes of molecules (VSEPR)',
    ],
    commonQuestionTypes: [
      'Draw the electron dot diagram for NaCl formation.',
      'Explain why H₂O is polar but CO₂ is non-polar.',
      'Predict the shape of NH₃ using VSEPR theory.',
    ],
    estimatedStudyHours: 12,
  },
  {
    name: 'Stoichiometry',
    code: 'CHM-003',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS1', 'SS2', 'SS3'],
    prerequisites: ['CHM-001'],
    subtopics: [
      'Mole concept',
      'Molar mass calculations',
      'Balancing chemical equations',
      'Limiting reagent',
      'Percentage yield',
      'Concentration (molarity, molality)',
    ],
    commonQuestionTypes: [
      'How many moles are in 36g of water (H₂O)?',
      'Balance: Fe + HCl → FeCl₃ + H₂',
      '25cm³ of 0.1M NaOH neutralizes 20cm³ of H₂SO₄. Find concentration of acid.',
    ],
    estimatedStudyHours: 15,
  },
  {
    name: 'Organic Chemistry',
    code: 'CHM-004',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['CHM-002'],
    subtopics: [
      'Hydrocarbons (alkanes, alkenes, alkynes)',
      'Functional groups (alcohols, acids, esters, aldehydes, ketones)',
      'Isomerism (structural, geometric)',
      'Organic reactions (substitution, addition, combustion)',
      'Polymers',
      'Petroleum/crude oil (very Nigerian!)',
    ],
    commonQuestionTypes: [
      'Write the structural formula of 2-methylbutane.',
      'Name the product when ethene reacts with bromine.',
      'Explain fractional distillation of crude oil.',
      'Draw the cis and trans forms of but-2-ene.',
    ],
    estimatedStudyHours: 18,
  },
  {
    name: 'Electrochemistry',
    code: 'CHM-005',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS3'],
    prerequisites: ['CHM-003'],
    subtopics: [
      'Oxidation and reduction',
      'Oxidation numbers',
      'Electrolysis',
      'Faraday\'s laws',
      'Electrochemical cells',
      'Corrosion',
    ],
    commonQuestionTypes: [
      'Calculate oxidation number of Mn in KMnO₄.',
      'During electrolysis of CuSO₄ using copper electrodes, what happens?',
      'Calculate mass of copper deposited by 2A current for 30 minutes.',
    ],
    estimatedStudyHours: 12,
  },
  {
    name: 'Chemical Equilibrium',
    code: 'CHM-006',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS3'],
    prerequisites: ['CHM-003'],
    subtopics: [
      'Dynamic equilibrium',
      'Le Chatelier\'s principle',
      'Equilibrium constant (Kc, Kp)',
      'Haber process',
      'Contact process',
    ],
    commonQuestionTypes: [
      'State Le Chatelier\'s principle.',
      'For N₂ + 3H₂ ⇌ 2NH₃, what happens when pressure increases?',
      'Write the expression for Kc for the Haber process.',
    ],
    estimatedStudyHours: 10,
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// ENGLISH CURRICULUM
// ───────────────────────────────────────────────────────────────────────────────

const englishTopics: CurriculumTopic[] = [
  {
    name: 'Essay Writing',
    code: 'ENG-001',
    examTypes: ['WAEC', 'NECO'],
    gradeLevels: ['SS1', 'SS2', 'SS3'],
    prerequisites: [],
    subtopics: [
      'Argumentative essays',
      'Descriptive essays',
      'Narrative essays',
      'Expository essays',
      'Article writing',
      'Formal and informal letters',
      'Speech writing',
    ],
    commonQuestionTypes: [
      'Write an article on: "The importance of education in national development"',
      'Write a letter to your friend describing your school.',
      'Write a speech on the dangers of drug abuse.',
    ],
    estimatedStudyHours: 15,
  },
  {
    name: 'Comprehension',
    code: 'ENG-002',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS1', 'SS2', 'SS3'],
    prerequisites: [],
    subtopics: [
      'Reading strategies',
      'Identifying main ideas',
      'Making inferences',
      'Understanding context',
      'Vocabulary in context',
      'Critical reading',
    ],
    commonQuestionTypes: [
      'Read the passage and answer the questions that follow.',
      'What is the writer\'s attitude toward...?',
      'Explain the meaning of the underlined word as used in the passage.',
    ],
    estimatedStudyHours: 10,
  },
  {
    name: 'Summary Writing',
    code: 'ENG-003',
    examTypes: ['WAEC', 'NECO'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['ENG-002'],
    subtopics: [
      'Identifying key points',
      'Concise expression',
      'Paraphrasing',
      'Note-making',
      'Avoiding redundancy',
    ],
    commonQuestionTypes: [
      'Summarize the passage in not more than 100 words.',
      'List six reasons why... according to the passage.',
    ],
    estimatedStudyHours: 8,
  },
  {
    name: 'Literature — Prose',
    code: 'ENG-004',
    examTypes: ['WAEC', 'NECO'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: [],
    subtopics: [
      'Plot and structure',
      'Characterization',
      'Setting',
      'Themes',
      'Narrative techniques',
      'Literary devices (irony, symbolism, flashback)',
    ],
    commonQuestionTypes: [
      'Discuss the role of [character] in the novel.',
      'How does the author use setting to enhance the theme?',
      'Examine the theme of [theme] in the text.',
    ],
    estimatedStudyHours: 12,
  },
  {
    name: 'Literature — Poetry',
    code: 'ENG-005',
    examTypes: ['WAEC', 'NECO'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: [],
    subtopics: [
      'Poetic devices (metaphor, simile, personification, imagery)',
      'Structure (stanza, rhyme, rhythm, meter)',
      'Tone and mood',
      'Themes in poetry',
      'Appreciation and analysis',
    ],
    commonQuestionTypes: [
      'Discuss the use of imagery in the poem.',
      'What is the poet\'s attitude toward the subject?',
      'Explain the significance of the title.',
    ],
    estimatedStudyHours: 10,
  },
  {
    name: 'Literature — Drama',
    code: 'ENG-006',
    examTypes: ['WAEC', 'NECO'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: [],
    subtopics: [
      'Elements of drama (plot, character, dialogue, setting)',
      'Dramatic techniques (soliloquy, aside, flashback)',
      'Comedy and tragedy',
      'Themes in drama',
      'Stage directions',
    ],
    commonQuestionTypes: [
      'Discuss the dramatic significance of [scene/act].',
      'How does the playwright create dramatic tension?',
      'Analyze the character of [character] and his role.',
    ],
    estimatedStudyHours: 10,
  },
  {
    name: 'Grammar & Lexis',
    code: 'ENG-007',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS1', 'SS2', 'SS3'],
    prerequisites: [],
    subtopics: [
      'Parts of speech',
      'Tenses',
      'Subject-verb agreement',
      'Direct and indirect speech',
      'Active and passive voice',
      'Clauses and phrases',
      'Synonyms and antonyms',
      'Word formation',
      'Idioms and proverbs',
    ],
    commonQuestionTypes: [
      'Choose the word that best completes the sentence.',
      'Identify the grammatical name and function of the underlined expression.',
      'Rewrite in indirect speech: He said, "I am coming."',
    ],
    estimatedStudyHours: 15,
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// BIOLOGY CURRICULUM
// ───────────────────────────────────────────────────────────────────────────────

const biologyTopics: CurriculumTopic[] = [
  {
    name: 'Cell Biology',
    code: 'BIO-001',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS1', 'SS2'],
    prerequisites: [],
    subtopics: [
      'Cell structure (plant vs animal)',
      'Cell organelles and functions',
      'Cell division (mitosis, meiosis)',
      'Cell transport (diffusion, osmosis, active transport)',
      'Microscopy',
    ],
    commonQuestionTypes: [
      'Draw and label a plant cell.',
      'Explain the function of mitochondria.',
      'Describe the stages of mitosis.',
      'Explain osmosis using a diagram.',
    ],
    estimatedStudyHours: 12,
  },
  {
    name: 'Genetics',
    code: 'BIO-002',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['BIO-001'],
    subtopics: [
      'Mendelian inheritance',
      'Punnett squares',
      'Monohybrid and dihybrid crosses',
      'Sex-linked inheritance',
      'Mutation',
      'Genetic engineering (basic)',
      'DNA structure and replication',
    ],
    commonQuestionTypes: [
      'A homozygous tall plant is crossed with a homozygous short plant. Find F₁ and F₂ ratios.',
      'Explain sex determination in humans.',
      'What is the probability of a carrier mother passing hemophilia to her son?',
    ],
    estimatedStudyHours: 14,
  },
  {
    name: 'Ecology',
    code: 'BIO-003',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: [],
    subtopics: [
      'Ecosystem components',
      'Food chains and food webs',
      'Energy flow in ecosystems',
      'Nutrient cycling (carbon, nitrogen, water)',
      'Ecological pyramids',
      'Population studies',
      'Conservation and pollution',
    ],
    commonQuestionTypes: [
      'Construct a food web using the following organisms...',
      'Explain the carbon cycle with a diagram.',
      'What are the effects of deforestation on the ecosystem?',
    ],
    estimatedStudyHours: 12,
  },
  {
    name: 'Human Physiology',
    code: 'BIO-004',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS2', 'SS3'],
    prerequisites: ['BIO-001'],
    subtopics: [
      'Digestive system',
      'Circulatory system (heart, blood, blood vessels)',
      'Respiratory system',
      'Excretory system (kidney, skin, liver)',
      'Nervous system',
      'Endocrine system',
      'Reproductive system',
      'Homeostasis',
    ],
    commonQuestionTypes: [
      'Describe the structure and function of the human heart.',
      'Explain how the kidney regulates water balance.',
      'Trace the path of food from ingestion to egestion.',
    ],
    estimatedStudyHours: 18,
  },
  {
    name: 'Evolution',
    code: 'BIO-005',
    examTypes: ['WAEC', 'NECO', 'JAMB'],
    gradeLevels: ['SS3'],
    prerequisites: ['BIO-002'],
    subtopics: [
      'Lamarck\'s theory',
      'Darwin\'s theory of natural selection',
      'Evidence of evolution',
      'Adaptation',
      'Speciation',
    ],
    commonQuestionTypes: [
      'Compare Lamarck\'s and Darwin\'s theories of evolution.',
      'Explain natural selection with an example.',
      'Give four evidences that support evolution.',
    ],
    estimatedStudyHours: 8,
  },
];

// ───────────────────────────────────────────────────────────────────────────────
// CURRICULUM DATABASE
// ───────────────────────────────────────────────────────────────────────────────

export const NIGERIAN_CURRICULUM: Record<string, NigerianCurriculum> = {
  mathematics: {
    subject: 'Mathematics',
    topics: mathematicsTopics,
    examSyllabus: {
      WAEC: ['MTH-001', 'MTH-002', 'MTH-003', 'MTH-004', 'MTH-005', 'MTH-006', 'MTH-007', 'MTH-008', 'MTH-010'],
      NECO: ['MTH-001', 'MTH-002', 'MTH-003', 'MTH-004', 'MTH-005', 'MTH-006', 'MTH-007', 'MTH-010'],
      JAMB: ['MTH-002', 'MTH-003', 'MTH-004', 'MTH-005', 'MTH-006', 'MTH-008', 'MTH-009', 'MTH-010'],
    },
  },
  physics: {
    subject: 'Physics',
    topics: physicsTopics,
    examSyllabus: {
      WAEC: ['PHY-001', 'PHY-002', 'PHY-003', 'PHY-004', 'PHY-005', 'PHY-006'],
      NECO: ['PHY-001', 'PHY-002', 'PHY-003', 'PHY-004', 'PHY-005', 'PHY-006'],
      JAMB: ['PHY-001', 'PHY-002', 'PHY-003', 'PHY-005', 'PHY-006'],
    },
  },
  chemistry: {
    subject: 'Chemistry',
    topics: chemistryTopics,
    examSyllabus: {
      WAEC: ['CHM-001', 'CHM-002', 'CHM-003', 'CHM-004', 'CHM-005', 'CHM-006'],
      NECO: ['CHM-001', 'CHM-002', 'CHM-003', 'CHM-004', 'CHM-005', 'CHM-006'],
      JAMB: ['CHM-001', 'CHM-002', 'CHM-003', 'CHM-004', 'CHM-005'],
    },
  },
  english: {
    subject: 'English Language',
    topics: englishTopics,
    examSyllabus: {
      WAEC: ['ENG-001', 'ENG-002', 'ENG-003', 'ENG-004', 'ENG-005', 'ENG-006', 'ENG-007'],
      NECO: ['ENG-001', 'ENG-002', 'ENG-003', 'ENG-004', 'ENG-005', 'ENG-006', 'ENG-007'],
      JAMB: ['ENG-002', 'ENG-007'],
    },
  },
  biology: {
    subject: 'Biology',
    topics: biologyTopics,
    examSyllabus: {
      WAEC: ['BIO-001', 'BIO-002', 'BIO-003', 'BIO-004', 'BIO-005'],
      NECO: ['BIO-001', 'BIO-002', 'BIO-003', 'BIO-004', 'BIO-005'],
      JAMB: ['BIO-001', 'BIO-002', 'BIO-003', 'BIO-004'],
    },
  },
};

// ───────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Look up curriculum data for a subject and topic
 */
export function lookupCurriculum(
  subject: string,
  topicQuery?: string,
  examType?: 'WAEC' | 'NECO' | 'JAMB'
): NigerianCurriculum | CurriculumTopic[] | null {
  const curriculum = NIGERIAN_CURRICULUM[subject.toLowerCase()];
  if (!curriculum) return null;

  if (!topicQuery) {
    return curriculum;
  }

  // Search for matching topics
  const query = topicQuery.toLowerCase();
  const matchingTopics = curriculum.topics.filter(topic =>
    topic.name.toLowerCase().includes(query) ||
    topic.subtopics.some(st => st.toLowerCase().includes(query)) ||
    topic.code.toLowerCase() === query
  );

  if (examType) {
    const syllabusCodes = curriculum.examSyllabus[examType] || [];
    return matchingTopics.filter(t => syllabusCodes.includes(t.code));
  }

  return matchingTopics;
}

/**
 * Get common question patterns for a topic
 */
export function getCommonQuestions(subject: string, topicName: string): string[] {
  const curriculum = NIGERIAN_CURRICULUM[subject.toLowerCase()];
  if (!curriculum) return [];

  const topic = curriculum.topics.find(t =>
    t.name.toLowerCase() === topicName.toLowerCase()
  );

  return topic?.commonQuestionTypes || [];
}

/**
 * Get topics for a specific exam type
 */
export function getExamTopics(
  subject: string,
  examType: 'WAEC' | 'NECO' | 'JAMB'
): CurriculumTopic[] {
  const curriculum = NIGERIAN_CURRICULUM[subject.toLowerCase()];
  if (!curriculum) return [];

  const syllabusCodes = curriculum.examSyllabus[examType] || [];
  return curriculum.topics.filter(t => syllabusCodes.includes(t.code));
}

/**
 * Get all subjects in the curriculum
 */
export function getAllSubjects(): string[] {
  return Object.values(NIGERIAN_CURRICULUM).map(c => c.subject);
}

/**
 * Estimate study time for a subject's exam syllabus
 */
export function estimateStudyTime(
  subject: string,
  examType: 'WAEC' | 'NECO' | 'JAMB'
): number {
  const topics = getExamTopics(subject, examType);
  return topics.reduce((sum, t) => sum + t.estimatedStudyHours, 0);
}
