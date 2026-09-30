// Training content for the Training tab. Edit freely: plain text, one idea per line.
// `id` must match the method keys in app.js (METHODS) so the Log screen can link to each tool.

export const FLOW = {
  title: 'How a fishing conversation usually flows',
  steps: [
    ['Care through prayer', 'Open the door by offering to pray. Listen for their need.'],
    ['15-second testimony', 'Briefly share what Jesus has done for you, then ask if they have a story like that.'],
    ['The gospel', 'Share the Jesus Story or draw the 3 Circles.'],
    ['Ask for a response', 'Where are they? Mark Green, Yellow, Red or Believer.'],
    ['Next step', 'Green: start a Discovery Bible Study, ideally with their family or friends. Always set a follow-up.'],
  ],
};

export const LIGHTS_GUIDE = [
  ['green', 'Green', 'Open and hungry. They want to hear more, want to study, or want to follow Jesus. Set up a Discovery Bible Study right away, preferably in their home with their family and friends. They may be a person of peace (Luke 10:5–7).'],
  ['yellow', 'Yellow', 'Friendly or curious, but not ready. Keep praying, and schedule a return visit or offer to pray again about their need.'],
  ['red', 'Red', 'Closed or uninterested. Bless them, thank them and move on graciously. Leave the door open for the Spirit to work.'],
  ['believer', 'Believer', 'Already follows Jesus. Encourage them. Ask if they\'re sharing their faith with their neighbors, and invite them to join you or to be trained. They may be the key to reaching the complex.'],
];

export const TOOLS = [
  {
    id: 'prayer',
    title: 'Care through prayer',
    time: '1–3 minutes',
    why: 'Prayer opens doors, shows the love of God right away, and reveals who the Lord is already working on. Jesus sent His disciples to speak peace and heal the sick (Luke 10:5–9).',
    steps: [
      'Introduce yourselves and why you\'re there: "We\'re from a church nearby, praying for our neighbors today."',
      'Ask: "Is there anything we can pray for you or your family about?"',
      'Listen well. Ask one gentle follow-up question about the need.',
      'Pray right there, briefly and specifically, in Jesus\' name. Ask permission to lay a hand on their shoulder if appropriate.',
      'After praying, ask: "Can I share why I love to pray for people?" → go to your 15-second testimony.',
    ],
    say: '"Hi, I\'m ___ and this is ___. We\'re out praying for people in the complex today. Is there anything we could pray about for you?"',
    tips: [
      'Keep the prayer short. The goal is to bless them and start a conversation.',
      'Log their prayer request in the app so the follow-up can ask how God answered.',
    ],
    verses: 'Luke 10:5–9 · Philippians 4:6 · James 5:16',
  },
  {
    id: 'testimony',
    title: '15-second testimony',
    time: '15 seconds',
    why: 'A short story of what Jesus has done in your life is easy to hear and hard to argue with. It shifts the conversation to spiritual things (Mark 5:19).',
    steps: [
      'Before: one phrase about what your life was like without Jesus (e.g. anxious, angry, empty, searching).',
      'Jesus: "Then I heard that Jesus died for my sins and rose again, and I put my faith in Him."',
      'After: one phrase about how He has changed you, using words a neighbor would relate to (e.g. peace, forgiveness, purpose).',
      'Ask: "Do you have a story like that?" or "Can I share how you can have that too?"',
    ],
    say: '"I used to be ___. Then I learned that Jesus died for my sins and rose from the dead, and I put my trust in Him. Now I have ___. Do you have a story like that?"',
    tips: [
      'Write yours out, time it, and cut words until it\'s 15 seconds.',
      'Avoid church words (saved, sanctified, born again) unless you explain them.',
      'Fit it to their prayer need: if they shared stress, share how Jesus gave you peace.',
    ],
    verses: 'Mark 5:19 · John 9:25 · 1 Peter 3:15',
  },
  {
    id: 'three_circles',
    title: '3 Circles',
    time: '3–5 minutes',
    why: 'A simple drawing that connects the brokenness people already feel to God\'s design and the good news of Jesus. Easy to learn, easy for a new believer to pass on.',
    steps: [
      'Start with brokenness: "We all see brokenness in the world and in our lives. Can I show you a simple picture that explains why?"',
      'Circle 1: God\'s design. God created everything good, including us, to know Him and live His way (Genesis 1:31).',
      'Arrow away: sin. We all chose our own way instead of God\'s (Romans 3:23).',
      'Circle 2: Brokenness. Sin leads to brokenness in every part of life, and ultimately death and separation from God (Romans 6:23). Draw loops: we try to escape it on our own (trying harder, religion, relationships, substances), but these can\'t fix it.',
      'Circle 3: The gospel. God loved us so much that He sent Jesus. He lived a perfect life, died on the cross for our sin and rose from the dead (John 3:16; 1 Corinthians 15:3–4).',
      'Arrow to the gospel: repent and believe. Turn from sin and trust Jesus (Mark 1:15; Romans 10:9).',
      'Arrow back to God\'s design: recover and pursue. With His Spirit, we can begin to recover and pursue God\'s design (Ephesians 2:10).',
      'Ask: "Where would you say you are in this picture?" and "Is there anything keeping you from turning to Jesus right now?"',
    ],
    say: '"Can I draw you a quick picture that explains the brokenness we see and what God did about it?"',
    tips: [
      'Draw it on paper or a phone and leave it with them.',
      'Let them hold the pen and redraw it. If they can draw it, they can share it with their family.',
    ],
    verses: 'Genesis 1:31 · Romans 3:23 · Romans 6:23 · John 3:16 · Mark 1:15 · Romans 10:9 · Ephesians 2:10',
  },
  {
    id: 'jesus_story',
    title: 'Jesus Story',
    time: '2–3 minutes',
    why: 'A short, memorized telling of the good news from Creation to the return of Christ. It keeps the gospel clear and complete, and ends with a direct question.',
    steps: [
      'God created: in the beginning God made everything and it was very good. He made people to walk with Him.',
      'We sinned: the first people disobeyed God, and sin and death entered the world. We have all sinned, and sin separates us from a holy God.',
      'God sent Jesus: God loved us and sent His Son. Jesus lived a perfect life, taught with authority, healed the sick and showed us who God is.',
      'Jesus died: He was crucified, taking the punishment for our sins that we deserved.',
      'Jesus rose: He was buried, and on the third day God raised Him from the dead. He appeared to many people and then returned to heaven.',
      'Jesus is coming back: He will return to judge the world and make all things new.',
      'Our response: everyone who turns from their sin and trusts in Jesus as Lord will be forgiven and given eternal life.',
      'Ask directly: "Do you believe this?" If yes: "Would you like to turn from your sin and follow Jesus today?"',
    ],
    say: '"Can I tell you the most important story in the world? It only takes a couple of minutes."',
    tips: [
      'Practice it out loud until you can tell it naturally in under 3 minutes.',
      'Don\'t skip the question at the end. Asking is part of the story.',
      'If they say yes, pray with them, then set up a Discovery Bible Study and mark the follow-up.',
    ],
    verses: '1 Corinthians 15:3–4 · Romans 5:8 · Acts 17:30–31 · John 11:25–26',
  },
  {
    id: 'dbs',
    title: 'Discovery Bible Study (DBS)',
    time: '45–60 minutes, weekly',
    why: 'A simple group study where people discover God from His Word themselves, and learn to obey and share it from the start. Best started with a whole household or friend group, led by them, not by you.',
    steps: [
      'Look back:',
      '  • What are you thankful for this week?',
      '  • What is stressing you out, or what do you need? (Pray for each other.)',
      '  • How did you obey last week\'s passage? Who did you share it with?',
      'Look up:',
      '  • Read the passage aloud, twice if possible.',
      '  • Have someone retell it in their own words; others fill in anything missed.',
      '  • What does this teach us about God?',
      '  • What does this teach us about people?',
      'Look forward:',
      '  • How will you obey this? ("I will…" statements)',
      '  • Who will you tell about what you learned this week?',
      '  • Is there a need in our community we can meet together?',
    ],
    say: '"Would you be willing to get a few family members or friends together to look at some stories from the Bible and see what they say for yourselves?"',
    tips: [
      'Facilitate, don\'t teach. Answer questions with "What does the passage say?"',
      'Start in Creation-to-Christ passages (Genesis 1–3, Noah, Abraham… to the Gospels) or a Gospel like Mark or Luke.',
      'Hand it off to someone in the group to facilitate as soon as possible.',
      'Log each DBS session as a follow-up so the team can see groups forming.',
    ],
    verses: 'Matthew 28:19–20 · James 1:22 · Luke 10:5–7 · John 6:45',
  },
];
