/*
 * English copy. Mirrors the shape of zh.js.
 * Plain words, short sentences, second person. Same voice as the Chinese site.
 */
export const en = {
  code: 'en',
  htmlLang: 'en',
  langToggle: { text: '中文', label: 'Switch to Chinese', title: '切换到中文' },
  meta: {
    home: {
      title: 'afkfactory · Requirement Clarification',
      description:
        'Download the client workspace, set it up in three steps, explain what you need, and send it back when you are done.',
    },
    download: {
      title: 'Download the client workspace · afkfactory',
      description:
        'Download the client workspace zip and check its version, date, and SHA256.',
    },
    skills: {
      title: 'Skills · afkfactory',
      description: 'What each of the seven skills does and when to use it.',
    },
    tutorial: {
      title: 'Guide · afkfactory',
      description:
        'Set up the client workspace in three steps, start your first conversation with the agent, and send it back.',
    },
    help: {
      title: 'Help & support · afkfactory',
      description: 'What to do when you are stuck, and what to send support.',
    },
    app: {
      title: 'Account · afkfactory',
      description: 'Log in to upload your workspace and check order progress.',
      login: 'Log in · afkfactory',
      orders: 'My orders · afkfactory',
      detail: 'Order details · afkfactory',
      upload: 'Upload workspace · afkfactory',
      missing: 'Page not found · afkfactory',
    },
  },

  site: {
    skip: 'Skip to content',
    navLabel: 'Main navigation',
    brandHome: 'afkfactory home',
    nav: {
      download: 'Download',
      skills: 'Skills',
      tutorial: 'Guide',
      login: 'Log in',
      orders: 'My orders',
      upload: 'Upload workspace',
      uploadShort: 'Upload',
    },
    theme: 'Switch light or dark mode',
    footerHelp: 'Help & support',
    footer: {
      download: 'Download',
      skills: 'Skills',
      tutorial: 'Guide',
      upload: 'Upload',
      login: 'Log in',
      orders: 'My orders',
    },
    scaffold: (path) => `Page scaffold · ${path} · Content pending`,
  },

  home: {
    titleAria: 'From a rough idea, to working software.',
    titleSegments: [{ text: 'From a rough idea,' }, { text: 'to working software.' }],
    lede: [
      'Download the client workspace and set it up in three steps.',
      { br: true, cls: 'home-lede-break' },
      ' ',
      'The agent uses a professional method to pin down what you need. When you are done, send the whole ',
      { span: 'folder', cls: 'home-keep' },
      ' back.',
    ],
    heroMeta: (release, size) => [
      `Client workspace ${release.version}`,
      { br: true },
      `${size} bytes · ${release.date}`,
      { br: true },
      'Works on macOS and Windows 64-bit',
    ],
    videoTitle: 'Sharper ideas, built faster.',
    videoNote: (skillCount) => [
      `${skillCount} skills pin down what you need first; then AI-era `,
      { span: 'low-cost', cls: 'home-keep' },
      ' development turns the idea into working software.',
    ],
    downloadAction: 'Download the client workspace',
    tutorialAction: 'Read the guide first',
    introTitle: [
      'You explain it clearly.',
      { br: true, cls: 'home-intro-break' },
      ' ',
      { span: 'We', cls: 'home-keep' },
      ' build it.',
    ],
    introLede: [
      'From download to handoff, just follow the guide.',
      { br: true },
      'Set up the workspace, explain what you need, send the folder back.',
    ],
    reasons: (count) => [
      {
        title: 'Ready to use',
        text: `All ${count} skills and the rules are already installed. No setup.`,
      },
      {
        title: 'Files stay on your computer',
        text: 'Your requirements and drafts stay local. The site only sends the download and receives the finished work.',
      },
      {
        title: 'Help when you are stuck',
        text: 'Every tutorial step says what you should see and what to do. Stuck? Send us a screenshot.',
      },
    ],
    stepsTitle: 'Set up in three steps',
    steps: [
      {
        n: '01',
        title: 'Download both',
        text: 'Get the workspace zip and the dsh installer before you continue.',
        check: 'You will see: two files in your downloads list',
      },
      {
        n: '02',
        title: 'Unzip into an empty folder',
        text: 'Unzip it. Do not open files directly inside the zip.',
        check: 'You will see: AGENTS.md at the top level of the folder',
      },
      {
        n: '03',
        title: 'Open dsh and speak',
        text: [
          'Choose the folder, then type ',
          { zh: '“开始需求澄清”' },
          ' (Start requirement clarification).',
        ],
        check: 'You will see: the agent asks your first question',
      },
    ],
    skillsTitle: (count) => [
      `${count} skills,`,
      { br: true },
      'ready to use.',
    ],
    skillsLede:
      'No studying, no names to memorize. The agent picks the right skill for you.',
    skillsLink: 'See the full list →',
    bandTitle: ['Done?', { br: true }, 'Send it back.'],
    bandText:
      'Zip the whole folder and upload it after you log in. Tick “All questions answered” and we will take it from there.',
    progressTitle: 'Progress, anytime.',
    progressText: 'Five stages, each spelled out. No need to chase us.',
    uploadAction: 'Upload workspace',
    ordersAction: 'My orders',
  },

  download: {
    title: 'Download the client workspace',
    lede: [
      'Unzip it into an empty folder, open it with dsh, and say ',
      { span: '“开始需求澄清”', cls: 'download-nowrap', lang: 'zh-CN' },
      ' (Start requirement clarification).',
    ],
    deviceNote:
      "Do this on a computer. Send this page's link to your computer first.",
    button: 'Download zip',
    actionNote: [
      'While a download is in progress, your browser adds a suffix to the file name. ',
      { span: 'Wait for it to disappear, then unzip.', cls: 'download-nowrap' },
      ' ',
      {
        span: ["Can't download? ", { a: '/help', text: 'Contact support' }, '.'],
        cls: 'download-nowrap',
      },
    ],
    inlineNext: 'Downloaded? Follow the setup guide →',
    spec: { version: 'Version', date: 'Date', size: 'Size' },
    size: (bytes, kb) => `${bytes} bytes (${kb} KB)`,
    sealWord: 'READY',
    sha: {
      summary: 'SHA256 & checksum',
      note: 'For support to verify the file',
      body: 'The SHA256 lets support check your file. You normally do not need it. If you are unsure after downloading, run a checksum and compare it with this value.',
      copy: 'Copy SHA256',
      copied: 'Copied',
      selected: 'Selected. Press Ctrl/⌘ + C, or press and hold to copy.',
      mac: 'Run this in Terminal on a Mac:',
      win: 'Run this in Command Prompt on Windows:',
      mismatch: [
        'If they do not match, first check that you downloaded the latest version, then ',
        { a: '/help', text: 'contact support' },
        '.',
      ],
    },
    systems: {
      title: 'Systems and setup',
      body: [
        'Works on ',
        { span: 'macOS (Apple silicon and Intel)', cls: 'download-nowrap' },
        ' and ',
        { span: 'Windows 64-bit', cls: 'download-nowrap' },
        '. Linux is not supported.',
      ],
      hints: [
        'Not sure which Mac chip you have: Apple menu → About This Mac → check the “Chip” line.',
        'Not sure if Windows is 64-bit: Settings → System → About → check the “System type” line.',
      ],
      dshBody:
        'The workspace opens with dsh. dsh is DeepSeek\'s desktop agent app.',
      dshLink: 'Not installed? Download dsh from DeepSeek →',
      dshHint: [
        'Cannot install it, or the workspace will not open? ',
        { a: '/help', text: 'Contact support' },
        '.',
      ],
    },
    steps: {
      title: 'Set up in three steps',
      items: [
        {
          n: '01',
          title: 'Download both',
          body: 'Download the workspace zip first, then the dsh installer. Get both before you continue.',
        },
        {
          n: '02',
          title: 'Unzip into an empty folder',
          body: 'Create an empty folder with an everyday name, such as “需求澄清”. Put the zip in it and extract it into that folder.',
          check:
            'Check: open the folder. You should see AGENTS.md at the top level. If you only see another folder with the same name, you have an extra layer.',
        },
        {
          n: '03',
          title: 'Open dsh and speak',
          body: 'Choose this folder in dsh, then say “开始需求澄清”. It checks itself first, then asks what you want to do.',
        },
      ],
      link: 'See the full guide (with screenshots) →',
    },
    next: {
      title: 'Next',
      body: 'Follow the three steps in the guide. It also covers what to say in the first conversation.',
      link: 'Open the guide →',
    },
  },

  skillDetails: {
    grilling: {
      summary: 'Several questions per round, each with a recommended answer',
      when: 'When you are talking through requirements and setting the end goal',
    },
    'domain-modeling': {
      summary: 'Pin down the words in your requirements and write them into a glossary',
      when: 'When one word has several meanings',
    },
    'grill-with-docs': {
      summary: 'Ask questions and add new terms to the glossary as you go',
      when: 'When you are clarifying requirements and defining terms',
    },
    wayfinder: {
      summary: 'Break a large project into topics and handle one at a time',
      when: 'When the work is too big for one conversation',
    },
    prototype: {
      summary: 'Show a rough version first, then revise it with you',
      when: 'When deciding what it looks like and how it works',
    },
    research: {
      summary: 'Look up facts and write the findings into a file',
      when: 'When a decision depends on a fact you need to check',
    },
    'wait-what': {
      summary: 'Re-explain the last passage when you did not follow',
      when: 'When you say “wait, I did not get that”',
    },
  },

  skills: {
    title: 'Skills',
    lede: 'What each skill does and when to use it. No need to choose. The agent decides.',
    count: (count) => `${count} skills`,
    whenLabel: 'When to use: ',
    nextTitle: 'Skills come with the workspace',
    nextBody:
      'Download and unzip it, then open it with dsh. The skills are already inside. The guide covers what to say first.',
    downloadLink: 'Download →',
    guideLink: 'Open the guide',
  },

  tutorial: {
    hero: {
      title: [
        'Set up in three steps,',
        { br: true },
        { span: 'then say what you want to build.' },
      ],
      lede: 'This guide takes you from a downloaded client workspace to your first conversation with the agent. No code anywhere. When you are done, send the whole folder back.',
      downloadButton: 'Download workspace',
      dshButton: ['Download dsh (DeepSeek Harness)', { span: ' ↗', ariaHidden: true }],
      meta: 'Works on macOS (Apple silicon / Intel) and Windows 64-bit. Linux is not supported. You need a computer with internet access.',
      needsTitle: 'Before you start, you will need',
      needs: [
        {
          title: 'dsh (DeepSeek Harness desktop)',
          body: 'The app that opens the workspace and talks with you.',
        },
        {
          title: (version) => `Client workspace ${version}`,
          body: (kb, count) =>
            `${kb} KB. ${count} skills and the rules are inside. Unzip and go.`,
        },
        {
          title: 'An empty folder',
          body: 'Give it an everyday name, such as “需求澄清”.',
        },
      ],
      needsFoot: 'No command line, no GitHub, and no extra skills to install.',
      altRoute: [
        'Write code and have your own project? Use the original ',
        {
          a: 'https://github.com/mattpocock/skills',
          text: 'mattpocock/skills package',
          external: true,
        },
        ' and install it into your project. This page only covers sections 4 and 5.',
      ],
    },
    railTitle: 'On this page',
    sectionLabels: {
      'step-1': 'Download both',
      'step-2': 'Unzip into an empty folder',
      'step-3': 'Open dsh and speak',
      'first-chat': 'Your first conversation',
      upload: 'Zip and send it back',
    },
    common: {
      stepLabel: (n) => `Step ${n}`,
      sectionLabel: (n) => `Section ${n}`,
      next: 'Next',
      copy: 'Copy',
      copySentence: 'Copy this line',
      copied: 'Copied',
      copyFailed: 'Could not copy. Select the text and copy it manually.',
      stuckTitle: 'Stuck at this step?',
      stuckAria: 'Stuck at this step',
      stuckLink: 'How to reach support →',
      checkTitle: 'You will see',
      doLabel: 'Do this',
      labelSuffix: ': ',
      fileMeta: (file, size, kb, version, date) =>
        `${file} · ${size} bytes (${kb} KB) · ${version} · ${date}`,
      downloadFile: (file) => `Download ${file}`,
    },
    steps: {
      'step-1': {
        label: 'Step 1',
        title: 'Download both',
        lead: 'dsh opens the workspace. The workspace package contains the rules and skills dsh reads. Get both, then continue.',
        subs: [
          {
            title: 'Download dsh',
            body: 'Go to the DeepSeek website, download the installer for your system, and follow the prompts.',
            table: [
              { platform: 'Windows 64-bit', file: 'dsh-latest-windows-x64.exe' },
              { platform: 'Mac · Apple silicon', file: 'dsh-latest-macos-arm64.dmg' },
              { platform: 'Mac · Intel', file: 'dsh-latest-macos-x64.dmg' },
            ],
            hint: 'Not sure which Mac chip you have: Apple menu → About This Mac → check the “Chip” line.',
            body2:
              'Open it once after installing. If you can see the folder picker, it is installed correctly. If the system shows a security warning during install, take a screenshot and contact support. Do not turn off system protection yourself.',
            link: 'Open the DeepSeek website ↗',
          },
          {
            title: 'Download the client workspace',
            body: (count) =>
              `${count} skills, rules, and instructions are inside. Unzip and use. No assembling.`,
            hint1:
              'After downloading, the file should appear in your browser download list. A trailing .download means it is not finished. Wait a moment and look again.',
            hint2:
              'To check that the file is not corrupted, the download page has the SHA256 and a command. You normally do not need it.',
            link: 'See version, date, and SHA256 →',
          },
        ],
        checkItems: (file) => [
          `Two files in your downloads list: the dsh installer and ${file}.`,
          'After dsh opens, you can see the folder picker.',
        ],
        stuck: {
          text: 'I am stuck at step 1. Downloading or installing dsh is not going well.',
          shot: 'Send a screenshot of the download page or your downloads list.',
        },
        next: { n: '02', label: 'Unzip into an empty folder' },
      },
      'step-2': {
        label: 'Step 2',
        title: 'Unzip into an empty folder',
        lead: 'The workspace needs its own folder. Open that folder every time; your progress lives inside it. Do not put it in an existing code project or mix it with other projects.',
        subs: [
          {
            title: 'Create an empty folder',
            body: 'Give it an everyday name, such as “需求澄清”. Put it somewhere you can find, like the Desktop or Documents.',
            hint: 'Avoid unusual symbols in the path. Chinese characters and spaces are fine.',
          },
          {
            title: 'Put the zip in it and extract here',
            body: 'Mac: double-click the zip; the system extracts a copy next to it. Windows: right-click the zip → Extract All, and choose this empty folder.',
            hint: 'Do not open files directly inside the archive app. Extract them first.',
          },
          {
            title: 'Check the file list',
            body: [
              'Open the folder after extracting. You should see ',
              { code: 'AGENTS.md' },
              ' at the top level. If you do, the location is right.',
            ],
          },
        ],
        specimenTitle: 'It should look like this',
        tree: [
          '需求澄清/',
          '├── ',
          'AGENTS.md',
          '\n├── README.txt\n├── 技能清单.md\n├── docs/\n└── .dsh/',
        ],
        caption: [
          { b: 'Seeing AGENTS.md means you are good. ' },
          'macOS Finder hides ',
          { code: '.dsh' },
          ' by default. Press ',
          { code: 'Cmd + Shift + .' },
          ' to show it. The folder may also contain LICENSE and NOTICE.md. Those are licenses and source notes; ignore them. From now on, you will open this “需求澄清” folder.',
        ],
        notes: [
          {
            title: 'An extra layer?',
            body: 'If opening the folder shows only one folder and no AGENTS.md, you have an extra layer. Drag everything inside out into the current folder.',
          },
          {
            title: 'One folder, one piece of software.',
            body: 'For a second piece of software, download a fresh copy of the latest workspace and unzip it into a new folder. This package does not update itself.',
          },
        ],
        stuck: {
          text: 'I am stuck at step 2. I cannot see AGENTS.md after unzipping.',
          shot: 'Send a screenshot of the whole file list, path included. Do not delete files yourself.',
        },
        next: { n: '03', label: 'Open dsh and speak' },
      },
      'step-3': {
        label: 'Step 3',
        title: 'Open dsh and speak',
        lead: 'The files are in place. Open dsh, select the folder, and say one sentence to begin.',
        subs: [
          {
            title: 'Open dsh and select the folder',
            body: 'Open the “需求澄清” folder in dsh. The path shown in the window should match the folder you just created. If you do not see a path, select it again.',
          },
          {
            title: 'Say the first sentence',
            body: 'Copy the line below, or just say what you want to build.',
            phrase: '开始需求澄清',
            hint: 'You can also just say it, for example “I want to build a booking mini-app for my barbershop.” The agent first decides whether this is big or small.',
            body2:
              'The agent first checks that three files are present, then gives a short introduction, then asks what you want to do. It lists several questions per round; answer one round, then it asks the next.',
          },
          {
            title: 'If a permission dialog appears, click Allow',
            body: 'When it needs to write a file, dsh asks. Click Allow so it can write progress into the folder.',
          },
        ],
        specimenTitle: 'It looks roughly like this in dsh',
        specimenPath: '~/Desktop/需求澄清',
        specimenUser: '开始需求澄清',
        specimenQuote:
          'First I will explain how this will go. Then tell me what you want to do. I will decide whether this is big or small.',
        specimenCaption:
          'The path in the window is the folder you just created. Send “开始需求澄清” and the conversation begins.',
        note: {
          title: 'If it says “files are in the wrong place, redo step 2 on the website”',
          body: 'Go back to step 2 and check the file list. Do not reinstall. Send this sentence and the file list to support.',
        },
        rulesTitle: 'After setup, remember three things',
        rules: [
          ['Open this folder every time. Change folders and your progress is gone.'],
          [
            'Progress is written in ',
            { code: '.scratch/' },
            '. Do not edit it yourself. Tell the agent what you want changed.',
          ],
          ['One folder, one piece of software. For a second piece, start a new folder.'],
        ],
        stuck: {
          text: 'I am stuck at step 3. dsh will not open the folder, or it says I do not have permission.',
          shot: 'Send a screenshot of the dsh window and the dialog. Do not reinstall repeatedly.',
        },
        next: { n: '04', label: 'Your first conversation' },
      },
      'first-chat': {
        label: 'Section 4',
        title: 'Your first conversation',
        lead: 'The agent first explains how things will go, then asks what you want to do. If the job is big, this conversation goes all the way through splitting it into topics and setting the order. If it is small, it ends after the questions. The rest of this section describes a big job in six steps. Small jobs branch off at step 3.',
        notes: [
          {
            title: 'Watch for one sentence.',
            body: 'On first open, the agent checks the workspace files. If it says “files are in the wrong place, redo step 2 on the website”, screenshot that sentence and the file list, then contact support. Do not reinstall.',
          },
          {
            title: 'If you hit a technical question you do not understand, say “I do not understand this.”',
            body: 'Tell the agent honestly, or the process gets stuck here. It will continue with the recommended answer, note it down, and someone will confirm with you before work starts.',
          },
        ],
        threeTitle: 'In a big job\'s six steps, you only do three things',
        threeRows: [
          'Say what you want',
          'Answer its questions',
          'Choose what comes first',
        ],
        threeNote:
          'In every new conversation after this, there is one extra thing: copy the line the agent gives you, exactly as it is.',
        chatSteps: [
          {
            title: 'The agent explains how things will go',
            body: 'It tells you: say what you want to do, and it decides whether the job is big or small. Small jobs get pinned down on the spot. Big jobs are split across several sessions. When it is done, just say what you are thinking.',
            quote: [
              'Let me first explain how this will go.',
              'You tell me what you want to do. I will decide whether it is big or small. If it is small, we settle it here and hand it to the developer. If it is a lot of work, we will split it into a few smaller tasks and do them over several sessions.',
              'You can start telling me your rough idea.',
            ],
            do: 'Listen, then say what you are thinking.',
          },
          {
            title: 'You say what you want to build',
            body: 'Use everyday words. No jargon, and you do not have to say everything at once. The agent reads this to decide whether the job is big or small.',
            do: 'Describe something you want to build.',
          },
          {
            title: 'The agent decides big or small',
            body: 'It decides, not you. After hearing your idea, it says which path you are on.',
            branch: [
              {
                title: 'Small job',
                quote:
                  '“This is not big. We can pin it down today. When we are done, I will turn it into a requirements draft and hand it to the developer.”',
                body: 'It asks a few rounds and you answer. The conversation ends there. No topic list.',
              },
              {
                title: 'Big job',
                quote: '“This needs to be split.”',
                body: 'Keep going. You will set the endpoint in one sentence, then split it into topics. Continue at step 4.',
              },
            ],
            do: 'Hear which path it chooses, then keep answering.',
          },
          {
            title: 'Set the endpoint in one sentence',
            body: 'The agent lists several questions per round, each with a recommended answer. You answer for your own situation. It distills the answers into one sentence: the endpoint.',
            quote: [
              'To split this, the first step is for us to decide what the finished thing should be. That is the endpoint. The endpoint is one sentence, for example “Customers browse today\'s fruit on WeChat, place an order, and choose pickup or delivery; you change prices and stock in the back office.”',
              'Please answer my questions yourself, and take them seriously. The questions are logically connected. One wrong step and everything after it follows the wrong path.',
            ],
            do: 'Answer yourself. If one round is not enough, take several.',
          },
          {
            title: 'Split it into topics',
            body: 'Once the endpoint is set, the agent says “the endpoint is set”, then splits the whole job into individual topics. One topic is one conversation, deciding one thing.',
            quote:
              '“Next I will split it into topics. Each topic represents one task. When all the tasks are done, what you asked for will exist.”',
            do: 'Wait for it to finish. You do not need to open or manage any files.',
          },
          {
            title: 'Read the list and choose what comes first',
            body: 'When it is done, it shows you the list: how many topics, what each one does. You set the order. Tell it which one goes first and it arranges them that way.',
            quote:
              '“When it is done, I will show you the list: how many topics, what each one does, and in what order. Tell me which one goes first and I will arrange it that way.”',
            body2:
              'Each topic also starts with a line saying whether this session is a discussion, a look at a rough version, hands-on building, or research.',
            do: 'Read the list and say which one comes first.',
          },
        ],
        after: {
          title: 'From now on, copy one line for each new conversation',
          body: 'Once the order is set, the agent says “topics are split, in the order you set”, then asks you to start a new conversation. It gives you one line. Copy it exactly. Do not change it.',
          exampleLabel: 'Example',
          example: '继续：tanxin-yuyue 01 空档怎么放',
          caption:
            'This is just an example. The requirement name, number, and topic name change every time. Use the line the agent gives you, not this one.',
          body2:
            'The agent picks up from there. You do not need to explain again. It first says three things: what this is meant to become and where it stands; how many decisions are set; and what the next topic is. Then it starts.',
        },
        taboos: {
          title: 'Three things this method is most afraid of',
          lede: 'The agent will warn you before splitting into topics. Remember these three, and the rest will go more smoothly.',
          items: [
            [
              'Discussing another topic inside the current one.',
              ' If you think of something, say so. I will note it on that topic, and we will finish this one first.',
            ],
            [
              'Wandering off mid-sentence.',
              ' If you wander, that is fine. Say it. I will note it down and bring us back.',
            ],
            [
              'Changing something decided earlier in a later topic.',
              ' If you want to change it, say so. I will go back to that original topic and record the change on the map. I will not quietly change it in a new topic.',
            ],
          ],
        },
        progressQuote:
          '“I write progress into this folder. You do not need to open or edit it. Tell me what you want changed.”',
        stuck: {
          text: 'I am stuck at step 4. The agent did not give the opening explanation, or keeps saying the files are in the wrong place.',
          shot: 'Send a screenshot of what the agent said and the file list.',
        },
        next: { n: '05', label: 'Zip and send it back' },
      },
      upload: {
        label: 'Section 5',
        title: 'Zip the whole folder and send it back',
        lead: 'When everything is done, the agent says “that is everything” and stops recommending another topic. Then send the whole workspace back. We will take it from there.',
        subs: [
          {
            title: 'Zip the whole folder',
            body: 'Mac: right-click the “需求澄清” folder → Compress “需求澄清”. Windows: right-click the folder → Compress to ZIP file.',
            hint: [
              'Zip the whole folder, not just ',
              { code: '.scratch/' },
              '. The archive must include ',
              { code: 'AGENTS.md' },
              ' and ',
              { code: '.scratch/' },
              '.',
            ],
          },
          {
            title: 'Open the upload page',
            body: 'The upload page is in the account area. Log in to get there.',
            button: 'Open the upload page →',
          },
          {
            title: 'Log in',
            body: 'Use the email and password we sent you. We create the account; we send the password on WeChat.',
            hint: ['Forgot your password? ', { a: '/help', text: 'Contact support' }, ' to reset it.'],
          },
          {
            title: 'Drag in the zip and tick “All questions answered”',
            body: 'Drag the archive into the upload box and tick “All questions answered”. Your short name and email come from the account. No need to fill them in.',
          },
          {
            title: 'Submit and wait for us',
            body: 'You are done when you see the upload succeeded. We handle the rest. No further action.',
          },
        ],
        note: 'Every file in the folder will be uploaded. Put only this project\'s material in it.',
        caption:
          'The conversation log is not in this folder, so it will not be uploaded. Keep the whole archive under 50 MB.',
        stuck: {
          text: 'I am stuck at step 5. The archive will not upload.',
          shot: 'Send a screenshot of the upload page and the error. Do not retry many times.',
        },
      },
    },
  },

  help: {
    title: 'Help & support',
    lede: 'Stuck? Do not reinstall. Send us these three things and we will take it from here.',
    qrSlot: 'QR code',
    qrPending: 'Added before launch',
    qrNote:
      'The WeChat ID will be added before launch too. For now, contact the person who signed you up.',
    contactTitle: 'Message the person who signed you up on WeChat',
    contactBody:
      'WeChat first, phone as a fallback. Message us on WeChat first. If we do not reply, we are busy or asleep. We will reply when we see it.',
    contactNote:
      'No need to be formal. Just be clear. “I am on the upload page and it says the zip is over 50 MB. Screenshot below.” That is enough.',
    sendTitle: 'Send these three things',
    sendItems: [
      'The page you were on, the button you clicked, and what went wrong. For order issues, include the order name.',
      'A screenshot that shows the window frame and the error.',
      'The exact message on the page. Copy it if you can.',
    ],
    dontTitle: 'Do not do these first',
    dontItems: [
      'Do not delete files, reinstall dsh, or move the folder yourself.',
      'Do not download many times. Read the error first.',
      'Do not send the workspace to anyone else. It contains your requirements.',
    ],
    stuckTitle: 'Common snags',
    stuckLede:
      'Check whether it is one of these. If you can get back to the right step yourself, no need to message us.',
    stuck: [
      {
        label: 'Download',
        text: 'The download stopped halfway, or the file name now ends in (1).',
        href: '/tutorial#step-1',
        link: 'Go to step 1',
      },
      {
        label: 'Unzip',
        text: 'You cannot see AGENTS.md after unzipping, or there is another folder inside.',
        href: '/tutorial#step-2',
        link: 'Go to step 2',
      },
      {
        label: 'First conversation',
        text: 'The agent does not respond, or says the files are in the wrong place.',
        href: '/tutorial#first-chat',
        link: 'Go to the first conversation',
      },
      {
        label: 'Upload',
        text: 'The archive will not upload, or it says it is over 50 MB.',
        href: '/tutorial#upload',
        link: 'Go to the upload step',
      },
      {
        label: 'Login & orders',
        text: 'You forgot your password, or the orders page will not open.',
        href: '/app/orders',
        link: 'Go to orders',
      },
    ],
    nextTitle: 'Next',
    nextBody:
      'If you are stuck during setup, go back to that step in the guide. If something is wrong after handoff, check your orders.',
    guideLink: 'Open the guide →',
    ordersLink: 'My orders',
  },

  account: {
    bar: {
      logout: 'Log out',
      loggingOut: 'Logging out…',
      logoutFailed: 'Logout did not work. Try again.',
    },
    app: {
      missingTitle: 'Page not found',
      missingBody: 'That address is wrong. Go home, or check your orders.',
      homeLink: 'Go home',
      ordersLink: 'My orders',
      loading: 'Opening…',
      errorTitle: 'Could not open your account',
      errorBody: 'The network may be down, or the service is restarting. Try again in a moment.',
      retry: 'Try again',
      helpHint: [
        'Still not opening? ',
        { a: '/help', text: 'Contact support' },
        '.',
      ],
    },
    login: {
      title: 'Log in',
      lede: 'Use the email and password we sent you.',
      pitch: [
        'After you log in, every order\'s stage and next step are in ',
        { span: '“My orders”', cls: 'login-nowrap' },
        '.',
      ],
      stagesTitle: 'The five stages you will see',
      note: [
        'We create your account and send the password on WeChat. Forgot it? ',
        { a: '/help', text: 'Message support on WeChat' },
        ' to reset it.',
      ],
      formTitle: 'Log in with email',
      email: 'Email',
      password: 'Password',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      submit: 'Log in',
      submitting: 'Logging in…',
      forgot: 'Forgot password?',
      forgotBody:
        'Message support on WeChat: “reset password”. We will send you a new one. Use the phone only if WeChat does not reach us.',
      forgotLink: 'How to reach support →',
      hint: [
        'No account yet? The first release is invite-only. To get one, ',
        { a: '/help', text: 'message support on WeChat' },
        '.',
      ],
      errorEmpty: 'Email and password are both required.',
      errorWrong: 'Wrong email or password. Forgot it? Message support on WeChat to reset it.',
      errorNetwork: 'Login did not work. Check your network and try again.',
    },
    orders: {
      title: 'My orders',
      lede: 'Where each order stands and what happens next.',
      uploadLink: 'Send a new request →',
      loading: 'Opening your orders…',
      errorTitle: 'Could not open your orders',
      errorBody: 'The network may be down, or the service is restarting. Try again in a moment.',
      retry: 'Try again',
      helpHint: [
        'Still not opening? ',
        { a: '/help', text: 'Contact support' },
        '.',
      ],
      emptyTitle: 'No orders yet',
      emptyBody:
        'Send back a finished workspace and your first order will appear here.',
      emptyAction: 'Upload workspace',
      emptyHint: [
        'Not sure how? ',
        { a: '/tutorial', text: 'Read the guide' },
        '.',
      ],
      summary: (total, bits) =>
        `You have ${total} ${total === 1 ? 'order' : 'orders'}.${bits.length ? ` ${bits.join(' ')}` : ''}`,
      summaryBits: {
        doing: (n) => `${n} in progress.`,
        invalid: (n) => `${n} waiting for files from you.`,
        trial: (n) => `${n} waiting for your review.`,
        received: (n) => `${n} just received.`,
        done: (n) => `${n} completed.`,
      },
      metaOrder: 'Order',
      round: (n) => `Round ${n}`,
      updated: (time) => `Updated ${time}`,
      noProgress: 'No progress yet',
      foot: [
        'You only see orders under your own account. Something wrong? ',
        { a: '/help', text: 'Contact support' },
        '.',
      ],
      checkFailed: 'Check failed',
    },
    detail: {
      back: 'My orders',
      status: 'Status',
      updated: (time) => `Updated ${time}`,
      noProgress: 'No progress yet',
      orderMeta: 'Order',
      progressTitle: 'Where it stands',
      progressHint: 'Pick a stage to see its steps.',
      now: {
        empty: 'No progress has been written for this order yet. Check back in a moment. Something wrong? Message support on WeChat.',
        invalidTitle: 'Fix it and upload once more',
        invalidBody: 'Still missing:',
        invalidFallback:
          'Check the message we sent you for what is missing and how to fix it. You can also ask support on WeChat.',
        invalidNote:
          'Upload again when it is fixed. It goes back to “Received”; you do not need to restate your requirements.',
        reupload: 'Upload again',
        rejectedTitle: 'This round fixes what you raised last round.',
        rejectedBody:
          'Once work starts, it begins again at “Work started”. We will let you try it when it is done.',
        rejectedWorkingBody:
          'This round begins again at “Work started”. We will let you try it when it is done.',
        trialTitle: 'Ready to try',
        trialBody: 'It is done. Please try these:',
        trialFallback:
          'We have sent you the trial checklist. Message us on WeChat if anything is wrong.',
        trialNote: 'Anything wrong? Message us on WeChat.',
        deliveryLink: 'Open the delivery address',
        doneTitle: 'This order is finished',
        doneBody:
          'If you want the repository, contact support to transfer it. Send a new request anytime.',
        newRequest: 'Send a new request',
        quietPrefix: 'You do not need to do anything. ',
        quietWorking: 'We are building it.',
        quietWorkingNote: 'We are building it. We will message you on WeChat when it is done.',
      },
      historyTitle: 'History',
      historyLede: 'Earlier rounds stay here, outside the progress bar.',
      historyRound: (round) => `Round ${round}`,
      historyNow: ' · current',
      historyCite: 'What you said last round',
      side: {
        aria: 'Order information',
        delivery: 'Delivery address',
        deliveryEmpty: 'No delivery address yet. We will send it when delivery is ready.',
        deliveryNote: 'We will deliver here. Message us on WeChat if that is wrong.',
        orderTitle: 'This order',
        number: 'Order number',
        uploadAt: 'Uploaded',
        round: 'Current round',
        roundValue: (n) => `Round ${n}`,
        updated: 'Last updated',
        missing: 'Not recorded',
        help: 'Questions',
        helpBody:
          'Message us on WeChat. Use the phone only if WeChat does not reach us.',
        helpLink: 'How to reach support →',
      },
      stateWords: {
        done: 'Completed',
        current: 'Current',
        pending: 'Not yet',
        warn: 'Needs attention',
      },
      stageDate: {
        pending: 'Not yet',
        rejected: (time) => `Revision ${time}`,
        waitFix: 'Waiting for your fix',
        updated: (time) => `Updated ${time}`,
        fixUpload: 'Upload needed',
        current: 'Here now',
        unknown: 'Time not recorded',
        arrived: (time) => `Arrived ${time}`,
      },
      loading: 'Opening this order…',
      errorTitle: 'Could not open this order',
      errorBody: 'The network may be down, or the service is restarting. Try again in a moment.',
      retry: 'Try again',
      helpHint: [
        'Still not opening? ',
        { a: '/help', text: 'Contact support' },
        '.',
      ],
      missingTitle: 'Order not found',
      missingBody:
        'The link may have expired, or this order is not under your account.',
      missingAction: 'Back to my orders',
      missingHint: [
        'Sure you are in the right place? ',
        { a: '/help', text: 'Contact support' },
        '.',
      ],
      panel: {
        stepperAria: 'Five stages',
        invalidPanelTitle: 'Check failed · What is missing',
        invalidTag: 'Action needed',
        invalidIntro:
          'We received the files, but something is still missing. Fix it and upload once more.',
        invalidNext:
          'Upload again when it is fixed. It goes back to “Received”; you do not need to restate your requirements.',
        futureTitle: (name) => `${name} · Not yet`,
        futureTag: 'Not yet',
        futureIntro: 'This stage has not started. We will message you on WeChat when it does.',
        pastTitle: (name) => `${name} · Completed`,
        pastTag: 'Done',
        pastIntro: 'This stage is complete.',
        currentTitle: (name, round) =>
          `${name}${round > 1 ? ` · Round ${round}` : ''} · steps`,
        currentTag: 'Current',
        rejectedIntro:
          'We are revising what you raised last round. This round has not started yet.',
        rejectedNext: 'Once work starts, it begins again at “Work started”.',
      },
    },
    upload: {
      title: 'Upload workspace',
      lede: 'When every question is answered, zip the whole workspace and send it back. Your short name and email come from the account. No need to fill them in.',
      confirmLogin: 'Checking your login…',
      serverErrorTitle: 'Could not reach the server',
      retry: 'Retry',
      loginTitle: 'Log in first',
      loginSub:
        'Use the email and password we sent you. We create the account. Forgot your password? Contact support.',
      email: 'Email',
      password: 'Password',
      loginSubmit: 'Log in',
      loggingIn: 'Logging in…',
      forgot: 'Forgot password? Contact support',
      loginEmpty: 'Email and password are both required.',
      loginBadEmail: 'That email does not look right. Check it.',
      loginWrong: 'Wrong email or password. Try again, or contact support.',
      loginDisabled: 'This account has been disabled. Contact support.',
      loginNoSession:
        'Login worked, but we could not read your account. Refresh the page and try again.',
      loginFailed: 'Login did not work. Try again later.',
      accountOut: 'Log out',
      accountOutBusy: 'Logging out…',
      sideAria: 'What to check before and after upload',
      sideTitle: 'Before you upload, check three things',
      sideLede: 'If the zip is wrong, we will ask you to send it again.',
      sideItems: [
        ['Zip the whole workspace folder, not just ', { code: '.scratch/' }, '.'],
        ['The folder contains ', { code: 'AGENTS.md' }, ' and ', { code: '.scratch/' }, '.'],
        [
          'The archive is under 50 MB. If it is bigger, delete what you do not need and zip it again.',
        ],
      ],
      sideSub: 'After upload',
      sideText:
        'We check it first, then create the order and schedule the work. Follow progress in “My orders”. No need to chase us.',
      sideStagesAria: 'Five stages',
      sideNote:
        'If the check fails, we will say what is missing and how to fix it. Upload again when it is fixed.',
      sideHelp:
        'Stuck here? Take a screenshot that shows the window frame and the error, and send it to support. WeChat first, phone as a fallback.',
      sideLink: 'How to reach support →',
      successTitle: "It's in.",
      successLede:
        'We are checking it, then we will schedule the work. Follow progress in “My orders”. No need to upload again.',
      successFile: 'File',
      successStatus: 'Status',
      successStatusValue: 'Received · checking',
      successOrders: 'See order progress',
      successAgain: 'Upload another',
      dropTitle: 'Drag the zip here',
      dropSub: 'Or click here to choose a file',
      dropLimit: 'ZIP only · up to 50 MB',
      fileReplace: 'Replace',
      finishedTitle: 'All questions answered',
      finishedHelp:
        'Tick this once everything is asked and the agent says there is no next topic.',
      finishedNote:
        'We only start processing the package after you tick “All questions answered”.',
      privacyTitle:
        'Every file in the folder will be uploaded. Put only this project\'s material in it.',
      privacyText: [
        'Conversation logs are in ',
        { code: '~/.dsh/sessions/' },
        ', outside the workspace. They are not uploaded.',
      ],
      submit: 'Upload',
      submitting: 'Uploading…',
      submitHints: {
        uploading: 'Uploading. Do not close this page.',
        error: 'Read the message above, fix it, then choose the file again.',
        empty: 'Choose a zip, then tick “All questions answered”.',
        noFile: 'You still need to choose a zip.',
        noFinished: 'One more step: tick “All questions answered”.',
        ready: 'Ready to upload.',
      },
      progressAria: 'Upload progress',
      progressDone: 'Upload finished. Waiting for the server…',
      progress: (pct) => `Uploading ${pct}%`,
      bytes: (bytes) => `${bytes} bytes`,
      fileNotZip:
        'ZIP files only. Zip the whole workspace folder into one file, then choose it.',
      fileEmpty: 'This file is empty. Zip it again, then choose it.',
      fileTooBig: (size) =>
        `This package is ${size}, over the 50 MB limit. Delete what you do not need, zip it again, then upload.`,
      serverTooBig:
        'The package is too big; the server did not accept it. Make sure the archive is under 50 MB and try again.',
      serverBadType: 'The server does not accept this format. Upload a .zip only.',
      serverRejected:
        'The server rejected this package. Read the message, fix it, and upload again.',
      serverError:
        'The server hit an error. Try again in a moment; if it keeps failing, contact support.',
      serverUnknown:
        'Upload did not work. Try again later; if it keeps failing, contact support.',
      sessionMissing:
        'We could not read your account. Refresh the page and try again.',
      sessionDisabled: 'This account has been disabled. Contact support.',
      sessionOffline: 'Could not reach the server. Try again later.',
      expired: 'Your login expired. Log in again and upload. The file is still here.',
      uploadDisabled: 'This account has been disabled and cannot upload. Contact support.',
      networkError:
        'Could not reach the server. The file is still here. Check your network, then click upload again.',
      aborted: 'Upload stopped. The file is still here. You can click upload again.',
    },
    api: {
      401: 'Please log in first.',
      403: 'This account cannot view this order.',
      404: 'Not found.',
      429: 'Too many tries. Come back in a moment.',
      noResponse: 'The service is not responding.',
    },
  },

  progress: {
    tiers: {
      已收到: {
        name: 'Received',
        short: 'We have your folder and are checking it.',
        intro:
          'We have received the folder you sent and are checking that everything is there.',
        next: 'Once it passes, it moves to “Scheduling”.',
        subs: {
          收包: { label: 'Folder received', desc: 'Your files are stored safely.' },
          校验: { label: 'Files checked', desc: 'We look for missing items and format issues.' },
        },
      },
      安排中: {
        name: 'Scheduling',
        short: 'Turning it into a work order.',
        intro:
          'We are arranging this into a work order we can start. You do not need to do anything at this stage.',
        next: 'Once confirmed, work starts and it moves to “In development”.',
        subs: {
          建单: {
            label: 'Order created',
            desc: 'Your request is registered as a work order.',
          },
          技术闸门: {
            label: 'Technical choices confirmed',
            desc: 'Our team confirms servers, accounts, and other technical choices.',
          },
          写规格: {
            label: 'Spec written',
            desc: 'Your requirements become instructions the developer can follow.',
          },
          拆票: {
            label: 'Split into tasks',
            desc: 'We divide it into smaller tasks that can run in parallel.',
          },
          点头: { label: 'Final check', desc: 'Our team checks that nothing was missed.' },
        },
      },
      开发中: {
        name: 'In development',
        short: 'Built piece by piece.',
        intro: 'We are building it. Each finished piece moves the progress forward.',
        next: 'When this stage is done, it moves to “Ready for your review”. We will message you on WeChat.',
        subs: {
          开工: { label: 'Work started', desc: 'This round\'s work is queued.' },
          子票开发: {
            label: 'Built piece by piece',
            desc: 'Each piece is built and checked.',
          },
          验证: {
            label: 'Automated checks',
            desc: 'We run checks to make sure existing features still work.',
          },
          评审: { label: 'Human review', desc: 'We review the result and how it looks.' },
          合分支: {
            label: 'Round changes merged',
            desc: 'This round\'s pieces are combined.',
          },
          合主干: {
            label: 'Merged into the release',
            desc: 'This round\'s changes go into the release.',
          },
          部署: { label: 'Deployed', desc: 'It is live, ready for you to try.' },
        },
      },
      待客户验收: {
        name: 'Ready for your review',
        short: 'Try it and tell us what needs fixing.',
        intro:
          'It is ready. We have sent you the address and a trial checklist. Try it and let us know.',
        next: 'When you say it is good, it moves to “Completed”.',
        subs: {
          打包: {
            label: 'Delivery packaged',
            desc: 'We prepare the address and files.',
          },
          等试用: {
            label: 'Waiting for your review',
            desc: 'Try it. Message us on WeChat if anything is wrong.',
          },
        },
      },
      已完成: {
        name: 'Completed',
        short: 'Done. We can transfer the repo if you need it.',
        intro:
          'This order is finished. If you want the repository, contact support to transfer it.',
        next: 'Send a new request anytime.',
        subs: {
          关单: { label: 'Closed', desc: 'This order is finished and will not change.' },
        },
      },
    },
    branches: {
      校验未通过: 'Check failed',
      已驳回: 'Revision requested',
    },
    lede: {
      noProgress: 'No progress has been recorded for this order yet. Check back in a moment.',
      invalid: 'We have your files, but something is still missing.',
      round: (n) => `This is round ${n}.`,
      doing: (done, total) =>
        `Working on piece ${done} of ${total}. We will message you on WeChat when it is done.`,
      trial: 'We have sent you the address and trial checklist. Try it and let us know.',
      done: 'This order is finished.',
    },
    subline: {
      none: 'No progress yet',
      invalid: 'Waiting for your files',
      rejected: 'Fixing last round\'s issues',
      done: 'Contact support to transfer the repo',
      trial: 'Waiting for your review',
      pieces: (done, total) => `Piece ${done} of ${total}`,
      subs: {
        收包: 'Files received',
        校验: 'Checking files',
        技术闸门: 'Confirming technical choices',
        写规格: 'Writing the spec',
        拆票: 'Splitting into tasks',
        点头: 'Final check',
        开工: 'Work started',
        验证: 'Automated checks',
        评审: 'Human review',
        合分支: 'Merging changes',
        合主干: 'Merging into the release',
        部署: 'Deploying',
        打包: 'Packaging delivery',
        等试用: 'Waiting for your review',
        关单: 'Closed',
      },
    },
    substep: {
      pieceLabel: (done, total) =>
        `Working on piece ${done}${total ? ` (of ${total})` : ''}`,
      pieceLabelFallback: 'Built piece by piece',
      invalidCheck:
        'The check found a problem. You need to add something, then upload again.',
    },
    stage: {
      invalidTitle: 'Check failed · What is missing',
      invalidTag: 'Action needed',
      invalidIntro:
        'We received the files, but something is still missing. Fix it and upload once more.',
      invalidNext:
        'Upload again when it is fixed. It goes back to “Received”; you do not need to restate your requirements.',
      futureTitle: (name) => `${name} · Not yet`,
      futureTag: 'Not yet',
      futureIntro: 'This stage has not started. We will message you on WeChat when it does.',
      pastTitle: (name) => `${name} · Completed`,
      pastTag: 'Done',
      pastIntro: 'This stage is complete.',
      currentTitle: (name, round) =>
        `${name}${round > 1 ? ` · Round ${round}` : ''} · steps`,
      currentTag: 'Current',
      rejectedIntro:
        'We are revising what you raised last round. This round has not started yet.',
      rejectedNext: 'Once work starts, it begins again at “Work started”.',
    },
  },
}
