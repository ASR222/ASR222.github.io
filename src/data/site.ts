// All copy comes from Abhay_Singh_Portfolio_Website_Content.md. Keep numbers in sync with it.

export const links = {
  email: 'abhaysinghjlr@gmail.com',
  github: 'https://github.com/ASR222',
  linkedin: 'https://www.linkedin.com/in/abhaysingh3101',
  codeforces: 'https://codeforces.com/profile/singhshreyanh312',
  resume: 'https://drive.google.com/file/d/18Z3VSMv9-9sUBJju6Jpe6HHx6ZK4mxqj/view?usp=sharing',
};

export type Figure = { label: string; value: number; display: string; tone: 'accent' | 'ink' | 'muted' };

export type Project = {
  slug: string;
  name: string;
  kind: string;
  year: string;
  oneLiner: string;
  tags: string[];
  links: { label: string; href: string }[];
  live?: { href: string; host: string };
  context?: string;
  problem: string;
  sections: { heading: string; items: string[] }[];
  figure?: { heading: string; caption: string; bars: Figure[] };
  stack: string;
  // the results a recruiter should see without opening the case study
  highlights: string[];
  // pictures for the case-study stage
  stage: Pane[];
  // the whole screen, uncropped, in the reading column
  shot: { src: string; alt: string; width: number; height: number; caption: string };
};

export type Pane =
  | { src: string; alt: string; position?: string; width: number; height: number; caption?: string }
  | { chart: true };

export const projects: Project[] = [
  {
    slug: 'cortexai',
    name: 'CortexAI',
    kind: 'Multi-agent AI platform',
    year: '2026',
    oneLiner:
      'A production-style AI platform where 4 Go microservices and a Python agent service route each request to one of 8 specialist AI agents, with billing that can’t double-charge.',
    highlights: [
      'One chat box routes each request to one of 8 specialist agents: search, coding, PDF Q&A, vision, reports and more.',
      'Billing can’t double-charge. Credits are reserved and refunded atomically, payment webhooks are idempotent, and race tests run against a real MongoDB.',
      '4 Go microservices and a Python agent service on Cloud Run, with all infrastructure in Terraform and keyless CI/CD.',
    ],
    tags: ['Go', 'Python', 'LangGraph', 'Microservices', 'RAG', 'GCP Cloud Run', 'Terraform'],
    links: [
      { label: 'Live demo', href: 'https://cortex-gateway-720170616128.asia-south1.run.app/' },
      { label: 'Source on GitHub', href: 'https://github.com/ASR222/cortex-ai' },
    ],
    live: { href: 'https://cortex-gateway-720170616128.asia-south1.run.app/', host: 'Cloud Run, asia-south1 (Mumbai)' },
    problem:
      'One assistant should handle very different jobs (cited web search, coding with live preview, PDF Q&A, vision, and PDF, slide and image generation) and still behave like a real product that is secure, bills correctly and can be deployed.',
    sections: [
      {
        heading: 'Architecture',
        items: [
          'Four Go microservices: gateway, auth, chat and billing.',
          'A Python FastAPI and LangGraph agent service routes each request through a workflow to one of eight specialist agents, streaming the answer token by token over SSE.',
          'MongoDB, Redis and Qdrant for data and vector search, and a React frontend.',
        ],
      },
      {
        heading: 'Decisions I’m proud of',
        items: [
          'Credits are reserved atomically before work starts and refunded on failure, so parallel requests can’t overspend.',
          'Razorpay payments are confirmed through both the browser callback and the webhook. Processing is idempotent, so a retry or a duplicate event never double-charges.',
          'Before every release, integration tests fire parallel requests against a real MongoDB to catch races.',
          'RAG over a user’s own PDFs uses Gemini embeddings and Qdrant, keeps each user’s documents isolated, and cites the page so you can check the answer.',
          'Server-side sessions, CSRF protection and per-service authentication block cross-user access, exposed internal APIs and replayed payments.',
          'It runs on Cloud Run with scale-to-zero, IAM service-to-service auth and Secret Manager, and deploys through keyless GitHub Actions using Workload Identity Federation. All of it is defined in Terraform and Docker.',
        ],
      },
    ],
    stack: 'Go, Python, FastAPI, LangGraph, LLMs, React, MongoDB, Redis, Qdrant, Docker, GCP Cloud Run, Terraform, GitHub Actions',
    stage: [
      { src: '/img/cortexai.jpg', alt: 'A CortexAI chat routed to the coding agent', position: '30% 50%', width: 1200, height: 750, caption: 'The coding agent, picked by the router' },
      { src: '/img/cortexai.jpg', alt: 'The code panel with the generated index.html', position: '100% 50%', width: 1200, height: 750, caption: 'The artifact panel, beside the chat' },
      { src: '/img/cortexai.jpg', alt: 'The CortexAI chat list and credit meter', position: '0% 50%', width: 1200, height: 750, caption: 'Chats, credits and the agent picker' },
    ],
    shot: { src: '/img/cortexai.jpg', alt: 'CortexAI routing a request to its coding agent, with the generated site open in the code panel', width: 1200, height: 750, caption: 'One turn in CortexAI: the router sends the request to the coding agent, which streams its answer and opens the files it wrote.' },
  },
  {
    slug: 'memledger',
    name: 'MemLedger',
    kind: 'Auditable memory for AI agents',
    year: '2026',
    oneLiner:
      'A multi-tenant graph memory where every belief an AI agent holds can be traced, time-travelled and retracted. It scored 15/16 on our evaluation, against 5/16 for a last-write-wins baseline.',
    highlights: [
      'Every belief records who wrote it, its source and what it replaced, with as-of time-travel queries.',
      '20 readers and parallel writers across 4 tenants ran with 0 errors and no data crossing tenants.',
      'One query retracts a compromised source across agents, up to 6 hops. Clients connect through an MCP server.',
    ],
    tags: ['Python', 'Graph DB', 'AI Agents', 'MCP', 'Evaluation'],
    links: [
      { label: 'Live demo', href: 'https://memledger-720170616128.asia-south1.run.app/demo' },
      { label: 'Demo video', href: 'https://www.youtube.com/watch?v=xmPvyoq3y0s' },
      { label: 'Source on GitHub', href: 'https://github.com/rudrakshSoni-dev/memledger-graphhacks' },
    ],
    live: { href: 'https://memledger-720170616128.asia-south1.run.app/demo', host: 'Cloud Run, asia-south1 (Mumbai)' },
    context: 'Built as a team for WeMakeDevs × FalkorDB GraphHacks 2026, in the Agent Memory and Coordination track.',
    problem:
      'When several AI agents share memory, one wrong or outdated fact spreads unnoticed, and nobody can say where it came from or undo it.',
    sections: [
      {
        heading: 'What it does',
        items: [
          'Shared memory for three incident-response agents (triage, investigation, comms). Every belief records who wrote it, its source, what it was derived from and what it replaced.',
          'Agents act through a tool-calling loop (recall, why, disputes, stale, conclude) and an MCP server, so clients such as Claude Desktop read the same memory under the same rules.',
          'Provenance tracing, supersession, as-of time-travel queries and one-query retraction of a compromised source across agents, up to six hops, built on 36 Cypher queries.',
          'Extraction is grounded: an LLM claim is kept only if its evidence appears verbatim in the source, and untrusted claims are quarantined.',
        ],
      },
      {
        heading: 'Results',
        items: [
          '15 of 16 on a 16-question evaluation, against 5 of 16 for a last-write-wins log.',
          'A concurrency test with 20 readers and parallel writers across 4 tenants finished with 0 errors and no data crossing tenants.',
        ],
      },
    ],
    figure: {
      heading: 'The evaluation',
      caption: 'Questions answered correctly out of 16.',
      bars: [
        { label: 'MemLedger', value: 15 / 16, display: '15 / 16', tone: 'accent' },
        { label: 'Last-write-wins log', value: 5 / 16, display: '5 / 16', tone: 'muted' },
      ],
    },
    stack: 'Python, FastAPI, FalkorDB, Cypher, Gemini, MCP, Docker, GCP Cloud Run',
    stage: [
      { src: '/img/memledger.jpg', alt: 'MemLedger answering why the team believes a root cause, over the memory graph', position: '58% 50%', width: 1200, height: 750, caption: 'Asking why: the fact, who wrote it, what it replaced' },
      { src: '/img/memledger.jpg', alt: 'The scripted incident demo, with a revoke withdrawing two facts', position: '0% 50%', width: 1200, height: 750, caption: 'One revoke withdraws everything that came from a source' },
      { src: '/img/memledger.jpg', alt: 'Trusted, compromised and untrusted sources, each with a revoke preview', position: '100% 50%', width: 1200, height: 750, caption: 'Sources, with trust and a revoke preview' },
    ],
    shot: { src: '/img/memledger.jpg', alt: 'MemLedger answering why the team believes a root cause: who wrote it, its source and the versions it replaced, over the memory graph', width: 1200, height: 750, caption: 'The live demo during an incident: the graph of beliefs, the scripted steps on the left and the sources on the right.' },
  },
  {
    slug: 'hazebusters',
    name: 'HazeBusters',
    kind: 'Serverless air-quality decisions',
    year: '2026',
    oneLiner:
      'A serverless AWS app that turns a 10-second phone clip into a go, limit or no decision on outdoor play for schools, in about 10 seconds.',
    highlights: [
      'Every reading shows its source and a confidence level; advice comes in English and Hindi, read aloud by Amazon Polly.',
      'Validated the CAMS model against 59 stations over 2 years; a ×1.25 correction catches about 2× more severe days.',
      'Dropped a model that scored 89% on seen days and 32% on unseen ones, below a 47.5% baseline.',
    ],
    tags: ['AWS Lambda', 'ONNX', 'Computer vision', 'Data validation', 'Bedrock'],
    links: [
      { label: 'Live demo', href: 'https://main.dxwuap9t49si3.amplifyapp.com/' },
      { label: 'Demo video', href: 'https://youtu.be/rxz5jJ9uge0' },
      { label: 'Source on GitHub', href: 'https://github.com/ASR222/hazebusters' },
    ],
    live: { href: 'https://main.dxwuap9t49si3.amplifyapp.com/', host: 'AWS Amplify, ap-south-1 (Mumbai)' },
    context: 'Built at WeMakeDevs × AWS Environmental Hacks 2026. The deployed sequel to my AQI Vision research.',
    problem: 'Most schools have no air-quality monitor nearby, yet they decide every day whether children play outside.',
    sections: [
      {
        heading: 'What I built',
        items: [
          'Live WAQI station data combined with the CAMS atmospheric model; every reading is shown with its source and a confidence level.',
          'Serverless on AWS: a Lambda container on ECR, S3, API Gateway, DynamoDB and Amplify, defined in SAM.',
          'Inference runs on CPU only. The vision pipeline (quality gate, smoke and fire model, YOLO11n vehicle count) runs as ONNX on Lambda, and CAM heatmaps are computed in NumPy from the ONNX outputs, so there is no PyTorch at runtime.',
          'Advice in English and Hindi from Amazon Bedrock (Nova), read aloud by Amazon Polly.',
        ],
      },
      {
        heading: 'Checking the data and models',
        items: [
          'Validated CAMS against 59 ground stations over two years of daily PM2.5, found a steady low bias, and applied a ×1.25 correction that catches about twice as many severe-pollution days in Delhi.',
          'Tested an EfficientNet-B0 image-to-AQI model out of sample: 89% on seen days, 32% on unseen days, below a 47.5% baseline. That was leakage, so I dropped the model and used the camera for smoke and fire detection instead.',
          'Fine-tuned a smoke and fire classifier on D-Fire with a near-duplicate-aware split (AP 0.979 smoke, 0.982 fire). On outside data (Pyro-SDIS) and our own clips it flagged urban haze as smoke, so it ships labelled experimental.',
        ],
      },
    ],
    figure: {
      heading: 'The model I dropped',
      caption: 'Accuracy of the image-to-AQI model. Unseen days fell below the baseline.',
      bars: [
        { label: 'Seen days', value: 0.89, display: '89%', tone: 'muted' },
        { label: 'Unseen days', value: 0.32, display: '32%', tone: 'accent' },
        { label: 'Baseline', value: 0.475, display: '47.5%', tone: 'ink' },
      ],
    },
    stack: 'Python, PyTorch, ONNX Runtime, OpenCV, YOLO11n, pandas, NumPy, AWS Lambda, ECR, S3, API Gateway, DynamoDB, Amplify, SAM, Amazon Bedrock, Polly',
    stage: [
      { src: '/img/delhi-smog.jpg', alt: 'Smog at the entry to New Delhi railway station, 31 December 2017', position: '45% 50%', width: 1920, height: 1312, caption: 'New Delhi railway station in smog, December 2017' },
      { src: '/img/hazebusters.jpg', alt: 'The Lambda processor: frames, quality gate, smoke and fire model, vehicle count, AQI, decision, advice', position: '62% 50%', width: 1200, height: 750, caption: 'The Lambda processor, step by step' },
      { src: '/img/hazebusters.jpg', alt: 'The phone app, API Gateway and S3 upload path', position: '0% 50%', width: 1200, height: 750, caption: 'The phone app and the upload path' },
    ],
    shot: { src: '/img/hazebusters.jpg', alt: 'HazeBusters on AWS: phone app, API Gateway, the Lambda processor, Bedrock, Polly and DynamoDB, in region ap-south-1', width: 1200, height: 750, caption: 'HazeBusters on AWS, in Mumbai: about ten seconds from an uploaded clip to advice on a phone.' },
  },
  {
    slug: 'aqi-vision',
    name: 'AQI Vision',
    kind: 'Research, image and video air quality',
    year: '2026',
    oneLiner:
      'Deep learning research that estimates air quality from images and video, and shows that a common evaluation shortcut overstates accuracy by about 30 points.',
    highlights: [
      'Showed that random frame splits overstate accuracy by about 30 points: 63% against 34%.',
      'Three-stream CNN for images, extended to video with a quality gate and YOLO11n + ByteTrack at ~12 FPS on one CPU thread.',
      'Served through FastAPI and Next.js, with 16 pytest tests.',
    ],
    tags: ['PyTorch', 'CNNs', 'Video analytics', 'Evaluation', 'Research'],
    links: [
      { label: 'Live demo', href: 'https://aqi-vision-classifier.vercel.app/predict' },
      { label: 'Research report', href: 'https://drive.google.com/file/d/1BIrUD7bAX5CPW-2NoF2C2Nb1smsxfKeb/view?usp=sharing' },
      { label: 'Source on GitHub', href: 'https://github.com/ASR222/AQI_project' },
    ],
    context: 'Minor project under Dr. Afaque Azam, Department of ECE, BIT Mesra. Team of three, 2026 to now.',
    problem: 'Can a photo or a dashcam clip tell you how bad the air is, and how do you know the answer isn’t just memorised?',
    sections: [
      {
        heading: 'What I did',
        items: [
          'Built a three-stream CNN (RGB, HSV saturation and SLIC superpixel inputs on EfficientNet-B0 backbones, fused late) that sorts scene images into six AQI levels, served through FastAPI and a Next.js frontend.',
          'Extended it to video: OpenCV frame sampling, a frame-quality gate (brightness, tiled Laplacian sharpness, sky fraction) and sliding-window averaging with a stability score.',
          'Added YOLO11n with ByteTrack to count unique vehicles and people, dwell time and the share of heavy vehicles, at about 12 FPS on a single CPU thread, behind a /predict-video API.',
          'Evaluated on TRAQID (13.8K dashcam frames with PM2.5 and PM10 readings) and showed that random frame splits inflate accuracy by about 30 points, 63% against 34%. Built tooling that holds out whole days or locations.',
          'Fixed a TensorFlow and PyTorch segfault by running the tracker in its own worker process. The project has 16 pytest tests.',
        ],
      },
    ],
    figure: {
      heading: 'Random splits overstate accuracy',
      caption: 'Accuracy on TRAQID, by how the test set was held out.',
      bars: [
        { label: 'Random frame split', value: 0.63, display: '63%', tone: 'muted' },
        { label: 'Whole days held out', value: 0.34, display: '34%', tone: 'accent' },
      ],
    },
    stack: 'Python, PyTorch, TensorFlow and Keras, OpenCV, YOLO11, ByteTrack, FastAPI, Next.js, pytest',
    stage: [
      { src: '/img/gurgaon-smog.jpg', alt: 'Smog over Gurgaon near Delhi, November 2016', position: '50% 50%', width: 1920, height: 1834, caption: 'Gurgaon in smog, November 2016' },
      { src: '/img/delhi-smog.jpg', alt: 'Smog at the entry to New Delhi railway station, 31 December 2017', position: '70% 50%', width: 1920, height: 1312, caption: 'New Delhi in smog, December 2017' },
      { src: '/img/campus-trees.jpg', alt: 'Morning light through the trees on the BIT Mesra campus', position: '35% 50%', width: 1056, height: 592, caption: 'Morning haze on the BIT Mesra campus' },
    ],
    shot: { src: '/img/gurgaon-smog.jpg', alt: 'Smog over Gurgaon near Delhi, November 2016, seen from a tower block', width: 1920, height: 1834, caption: 'The kind of scene the model reads: a street-level view with sky, where haze shows as lost contrast and colour.' },
  },
];

export const experience = [
  {
    role: 'SDE Intern',
    org: 'AnugatAI',
    dates: 'Oct 2025 – Mar 2026',
    // put the files in public/img/logos/; each shows only once its file exists
    label: { src: '/img/logos/anugatai-label.png', alt: 'Anugat AI' },
    banner: { src: '/img/logos/anugatai-wordmark.png', alt: 'अनुगत AI, one who walks alongside' },
    points: [
      'Designed and deployed backend services in Node.js and TypeScript that held ~550 ms API latency and 99.9% uptime in production.',
      'Implemented rate limiting, load balancing and caching to support 11K+ concurrent users on a chatbot platform.',
    ],
  },
  {
    role: 'Full Stack Developer Intern',
    org: 'FireLLama Technology',
    dates: 'May 2026 – Jul 2026',
    label: { src: '/img/logos/firellama-wordmark.png', alt: 'FireLLama' },
    banner: { src: '/img/logos/firellama-card.png', alt: 'FireLLama Technology Private Limited' },
    points: [
      'Built and integrated the Admin module of a sales portal in Next.js, React, Redux, Express, MongoDB and TypeScript.',
      'Integrated authentication REST services, validated JWT login flows and built Express API routes.',
      'Tested APIs with Postman, debugged auth issues and problems between the frontend and backend, and documented the endpoints.',
    ],
  },
];

export const honours = [
  { name: 'Booking Holdings HackCellence', note: 'Finalist, in-person Bangalore finale', year: '2026', banner: { src: '/img/logos/hackcellence-banner.png', alt: 'HackCellence 2026, the Embark edition, by Booking Holdings Centers of Excellence, powered by HackerEarth' } },
  { name: 'Paytm Build for India AI Hackathon', note: 'Finalist, Merchant Save Desk (Track 03)', year: '2026', banner: { src: '/img/logos/paytm-banner.png', alt: 'Paytm AI Hackathon, Build for India' } },
  { name: 'BPlan Ideathon', note: 'Winner twice, led the team to a five-figure prize', year: '2×' },
  { name: 'Codeforces', note: 'Pupil', year: 'Rated', href: 'https://codeforces.com/profile/singhshreyanh312' },
  { name: 'Layer5 Meshery', note: 'Open-source contributor to a CNCF cloud native manager', year: 'OSS', href: 'https://github.com/meshery/meshery' },
];

export const skills = [
  { group: 'Languages', items: 'Go, Python, C++, TypeScript, SQL' },
  { group: 'Backend', items: 'Microservices, REST, FastAPI, Node.js, SSE, concurrency, idempotency, caching, rate limiting, JWT auth' },
  { group: 'AI and ML', items: 'LLMs, agents, LangGraph, RAG, vector databases, MCP, PyTorch, OpenCV, YOLO11, ONNX Runtime, evaluation' },
  { group: 'Cloud', items: 'AWS (Lambda, S3, DynamoDB, Bedrock, SAM), GCP (Cloud Run, IAM, Secret Manager), Docker, Terraform, GitHub Actions' },
  { group: 'Data', items: 'PostgreSQL, MongoDB, Redis, DynamoDB, Qdrant, FalkorDB, SQL Server' },
];
