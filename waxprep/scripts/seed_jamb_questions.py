import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from waxprep.app.database.client import get_db_client

STARTER_QUESTIONS = [
    {
        "subject": "biology",
        "topic": "cell biology",
        "question_text": "Which organelle is responsible for producing energy (ATP) in a cell?",
        "option_a": "Nucleus",
        "option_b": "Mitochondria",
        "option_c": "Ribosome",
        "option_d": "Golgi apparatus",
        "correct_option": "B",
        "explanation": "Mitochondria are called the powerhouse of the cell because they produce ATP through cellular respiration.",
        "difficulty": 1,
        "waec_also": True,
    },
    {
        "subject": "biology",
        "topic": "photosynthesis",
        "question_text": "What is the overall equation for photosynthesis?",
        "option_a": "C6H12O6 + 6O2 → 6CO2 + 6H2O + energy",
        "option_b": "6CO2 + 6H2O + light energy → C6H12O6 + 6O2",
        "option_c": "CO2 + H2O → glucose + oxygen",
        "option_d": "Glucose + oxygen → carbon dioxide + water",
        "correct_option": "B",
        "explanation": "Photosynthesis converts carbon dioxide and water into glucose and oxygen using light energy. The full equation shows 6 molecules of CO2 and 6 molecules of water.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "biology",
        "topic": "genetics",
        "question_text": "If both parents are heterozygous (Tt) for tallness, what fraction of offspring will be short (tt)?",
        "option_a": "1/4",
        "option_b": "1/2",
        "option_c": "3/4",
        "option_d": "0",
        "correct_option": "A",
        "explanation": "Tt × Tt gives TT:Tt:Tt:tt in ratio 1:2:1. Only tt is short, which is 1 out of 4, so 1/4.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "biology",
        "topic": "kidney excretion",
        "question_text": "Which part of the nephron is responsible for ultrafiltration?",
        "option_a": "Loop of Henle",
        "option_b": "Collecting duct",
        "option_c": "Bowman's capsule and glomerulus",
        "option_d": "Proximal convoluted tubule",
        "correct_option": "C",
        "explanation": "Ultrafiltration occurs in the Bowman's capsule where blood is filtered under high pressure through the glomerular capillaries.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "biology",
        "topic": "ecology",
        "question_text": "In a food chain, which organism is always a producer?",
        "option_a": "Herbivore",
        "option_b": "Carnivore",
        "option_c": "Green plant",
        "option_d": "Decomposer",
        "correct_option": "C",
        "explanation": "Green plants (and algae) are producers because they make their own food through photosynthesis using sunlight.",
        "difficulty": 1,
        "waec_also": True,
    },
    {
        "subject": "mathematics",
        "topic": "quadratic equations",
        "question_text": "Solve for x: x² - 5x + 6 = 0",
        "option_a": "x = 2 or x = 3",
        "option_b": "x = -2 or x = -3",
        "option_c": "x = 1 or x = 6",
        "option_d": "x = -1 or x = -6",
        "correct_option": "A",
        "explanation": "Factorize: (x-2)(x-3) = 0. So x = 2 or x = 3. Check: (2)²-5(2)+6 = 4-10+6 = 0.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "mathematics",
        "topic": "logarithms",
        "question_text": "Find the value of log₂(32)",
        "option_a": "4",
        "option_b": "5",
        "option_c": "6",
        "option_d": "3",
        "correct_option": "B",
        "explanation": "log₂(32) asks: 2 to what power equals 32? Since 2⁵ = 32, the answer is 5.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "mathematics",
        "topic": "circle theorems",
        "question_text": "The angle subtended by an arc at the centre is related to the angle it subtends at any point on the remaining part of the circle. What is the relationship?",
        "option_a": "They are equal",
        "option_b": "The centre angle is half the circumference angle",
        "option_c": "The centre angle is twice the circumference angle",
        "option_d": "The circumference angle is twice the centre angle",
        "correct_option": "C",
        "explanation": "The angle at the centre is twice the angle at the circumference when both are subtended by the same arc. This is one of the core circle theorems.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "mathematics",
        "topic": "statistics",
        "question_text": "The scores of 5 students are: 12, 18, 15, 9, 16. What is the mean score?",
        "option_a": "14",
        "option_b": "15",
        "option_c": "13",
        "option_d": "16",
        "correct_option": "A",
        "explanation": "Mean = (12+18+15+9+16) ÷ 5 = 70 ÷ 5 = 14",
        "difficulty": 1,
        "waec_also": True,
    },
    {
        "subject": "mathematics",
        "topic": "simultaneous equations",
        "question_text": "Solve simultaneously: 2x + y = 7 and x - y = 2",
        "option_a": "x = 2, y = 3",
        "option_b": "x = 3, y = 1",
        "option_c": "x = 1, y = 5",
        "option_d": "x = 4, y = -1",
        "correct_option": "B",
        "explanation": "Adding the equations: 3x = 9, so x = 3. Substituting: 3 - y = 2, so y = 1. Check: 2(3)+1 = 7.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "physics",
        "topic": "equations of motion",
        "question_text": "A car starts from rest and accelerates uniformly at 4 m/s² for 5 seconds. What is its final velocity?",
        "option_a": "16 m/s",
        "option_b": "20 m/s",
        "option_c": "24 m/s",
        "option_d": "10 m/s",
        "correct_option": "B",
        "explanation": "Using v = u + at. u = 0 (starts from rest), a = 4 m/s², t = 5s. So v = 0 + (4)(5) = 20 m/s.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "physics",
        "topic": "equations of motion",
        "question_text": "A ball is dropped from rest and falls for 3 seconds. How far does it fall? (g = 10 m/s²)",
        "option_a": "30 m",
        "option_b": "45 m",
        "option_c": "90 m",
        "option_d": "15 m",
        "correct_option": "B",
        "explanation": "Using s = ut + ½at². u = 0, a = 10 m/s², t = 3s. s = 0 + ½(10)(9) = 45 m.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "physics",
        "topic": "electricity",
        "question_text": "Three resistors of 2Ω, 3Ω, and 6Ω are connected in parallel. What is the total resistance?",
        "option_a": "11Ω",
        "option_b": "1Ω",
        "option_c": "0.5Ω",
        "option_d": "2Ω",
        "correct_option": "B",
        "explanation": "1/R = 1/2 + 1/3 + 1/6 = 3/6 + 2/6 + 1/6 = 6/6 = 1. So R = 1Ω.",
        "difficulty": 3,
        "waec_also": True,
    },
    {
        "subject": "physics",
        "topic": "waves",
        "question_text": "A wave has a frequency of 50 Hz and a wavelength of 2 m. What is its speed?",
        "option_a": "25 m/s",
        "option_b": "52 m/s",
        "option_c": "100 m/s",
        "option_d": "48 m/s",
        "correct_option": "C",
        "explanation": "v = fλ = 50 × 2 = 100 m/s. The wave equation: speed equals frequency times wavelength.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "physics",
        "topic": "newton laws",
        "question_text": "Newton's Second Law of Motion states that force equals:",
        "option_a": "mass divided by acceleration",
        "option_b": "mass multiplied by velocity",
        "option_c": "mass multiplied by acceleration",
        "option_d": "weight multiplied by distance",
        "correct_option": "C",
        "explanation": "Newton's Second Law: F = ma. Force equals mass times acceleration. The units are Newtons (N) = kg × m/s².",
        "difficulty": 1,
        "waec_also": True,
    },
    {
        "subject": "chemistry",
        "topic": "atomic structure",
        "question_text": "An element has atomic number 17 and mass number 35. How many neutrons does it have?",
        "option_a": "17",
        "option_b": "35",
        "option_c": "18",
        "option_d": "52",
        "correct_option": "C",
        "explanation": "Neutrons = Mass number - Atomic number = 35 - 17 = 18. This element is chlorine (Cl).",
        "difficulty": 1,
        "waec_also": True,
    },
    {
        "subject": "chemistry",
        "topic": "ionic bonding",
        "question_text": "Which type of bonding involves the complete transfer of electrons from one atom to another?",
        "option_a": "Covalent bonding",
        "option_b": "Metallic bonding",
        "option_c": "Ionic bonding",
        "option_d": "Hydrogen bonding",
        "correct_option": "C",
        "explanation": "Ionic bonding involves complete transfer of electrons from a metal to a non-metal. The metal becomes a positive ion (cation) and the non-metal becomes a negative ion (anion).",
        "difficulty": 1,
        "waec_also": True,
    },
    {
        "subject": "chemistry",
        "topic": "mole concept",
        "question_text": "What is the molar mass of water (H₂O)? (H=1, O=16)",
        "option_a": "16 g/mol",
        "option_b": "17 g/mol",
        "option_c": "18 g/mol",
        "option_d": "20 g/mol",
        "correct_option": "C",
        "explanation": "Molar mass of H₂O = (2 × 1) + 16 = 2 + 16 = 18 g/mol. Two hydrogen atoms plus one oxygen atom.",
        "difficulty": 1,
        "waec_also": True,
    },
    {
        "subject": "chemistry",
        "topic": "acids bases",
        "question_text": "Which of the following is a property of acids?",
        "option_a": "They turn red litmus paper blue",
        "option_b": "They have a pH greater than 7",
        "option_c": "They react with metals to produce hydrogen gas",
        "option_d": "They taste bitter",
        "correct_option": "C",
        "explanation": "Acids react with metals (like zinc or iron) to produce hydrogen gas. Acids turn BLUE litmus RED (not the other way), have pH less than 7, and taste sour (not bitter).",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "chemistry",
        "topic": "electrochemistry",
        "question_text": "During electrolysis, which electrode is where oxidation occurs?",
        "option_a": "Cathode",
        "option_b": "Anode",
        "option_c": "Both equally",
        "option_d": "Neither — it occurs in solution",
        "correct_option": "B",
        "explanation": "At the ANODE, oxidation occurs (ions lose electrons). At the CATHODE, reduction occurs (ions gain electrons). Remember: OILRIG — Oxidation Is Loss, Reduction Is Gain.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "english",
        "topic": "concord",
        "question_text": "Choose the correct sentence: Neither of the students ___ completed the assignment.",
        "option_a": "have",
        "option_b": "has",
        "option_c": "are",
        "option_d": "were",
        "correct_option": "B",
        "explanation": "'Neither' when used with 'of' takes a singular verb. So 'neither of the students has' is correct, not 'have'.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "english",
        "topic": "reported speech",
        "question_text": "Change to reported speech: She said, 'I am studying now.'",
        "option_a": "She said that she is studying now.",
        "option_b": "She said that she was studying then.",
        "option_c": "She said that she studied then.",
        "option_d": "She said that she has been studying.",
        "correct_option": "B",
        "explanation": "When changing to reported speech: present continuous becomes past continuous (am → was), and 'now' changes to 'then'.",
        "difficulty": 2,
        "waec_also": True,
    },
    {
        "subject": "english",
        "topic": "oral english",
        "question_text": "Which of the following words contains the vowel sound /ɪ/ (as in 'bit')?",
        "option_a": "beat",
        "option_b": "seat",
        "option_c": "women",
        "option_d": "feet",
        "correct_option": "C",
        "explanation": "'Women' is pronounced /ˈwɪmɪn/ — the 'o' in 'women' makes the /ɪ/ sound, just like 'bit'. The other options all have the /iː/ long vowel sound.",
        "difficulty": 3,
        "waec_also": True,
    },
]

def seed_questions():
    db = get_db_client()
    existing = db.table("jamb_questions").select("id", count="exact").execute()
    if existing.count and existing.count >= len(STARTER_QUESTIONS):
        print(f"Database already has {existing.count} questions. Skipping seed.")
        return

    print(f"Seeding {len(STARTER_QUESTIONS)} starter questions...")
    inserted = 0
    skipped = 0

    for q in STARTER_QUESTIONS:
        try:
            check = (
                db.table("jamb_questions")
                .select("id")
                .eq("subject", q["subject"])
                .eq("question_text", q["question_text"])
                .execute()
            )
            if check.data:
                skipped += 1
                continue

            db.table("jamb_questions").insert(q).execute()
            inserted += 1
            print(f"  Added: [{q['subject']}] {q['question_text'][:60]}...")
        except Exception as e:
            print(f"  Failed to insert question: {e}")

    print(f"\nDone. Inserted: {inserted}, Skipped (duplicates): {skipped}")
    print(f"Total questions now: {inserted + (existing.count or 0)}")

if __name__ == "__main__":
    seed_questions()
