/**
 * seed.mjs — Run once to populate the dashboard with fully-classified requests.
 * Usage: node seed.mjs
 *
 * This bypasses BullMQ entirely and writes directly to MongoDB so your
 * dashboard shows completed, classified data immediately.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cognifyr_db';

// ── Inline schema-light models (no imports needed from src/) ─────────────────
const RequestEventSchema = new mongoose.Schema({ requestId: mongoose.Types.ObjectId, eventType: String, oldValue: mongoose.Schema.Types.Mixed, newValue: mongoose.Schema.Types.Mixed, actor: mongoose.Schema.Types.Mixed, metadata: mongoose.Schema.Types.Mixed }, { timestamps: true, collection: 'request_events', versionKey: false });
const AIClassSchema      = new mongoose.Schema({ requestId: mongoose.Types.ObjectId, provider: String, category: String, priority: String, summary: String, confidence: Number, reason: String, modelVersion: String, latencyMs: Number, rawOutput: mongoose.Schema.Types.Mixed, errorState: mongoose.Schema.Types.Mixed }, { timestamps: true, collection: 'ai_classifications', versionKey: false });
const RequestSchema      = new mongoose.Schema({ originalMessage: String, sourceChannel: String, status: String, categorySnapshot: String, prioritySnapshot: String, customer: mongoose.Schema.Types.Mixed, classificationId: mongoose.Types.ObjectId, resolvedAt: Date, metadata: mongoose.Schema.Types.Mixed }, { timestamps: true, collection: 'customer_requests', versionKey: false });

const Event   = mongoose.model('SeedEvent',  RequestEventSchema);
const AIClass = mongoose.model('SeedAIClass', AIClassSchema);
const Request = mongoose.model('SeedRequest', RequestSchema);

// ── Sample data ───────────────────────────────────────────────────────────────
const SAMPLES = [
  {
    message:  'I was double-charged on my last invoice. My card was billed twice for the same subscription and I need a refund immediately.',
    channel:  'email',
    category: 'billing',
    priority: 'high',
    confidence: 0.92,
    summary:  'Customer reports a duplicate billing charge on their subscription invoice and is requesting an immediate refund.',
    reason:   'Message contains explicit billing and charge-related terminology indicating a financial dispute.',
    customer: { name: 'Sarah Johnson', email: 'sarah.johnson@example.com', phone: '+1-555-0101' },
  },
  {
    message:  'URGENT: Our entire team cannot access the platform since this morning. The app throws a 500 error on every login attempt. This is completely broken.',
    channel:  'chat',
    category: 'technical',
    priority: 'critical',
    confidence: 0.97,
    summary:  'Customer reports a critical platform outage — all users are receiving 500 errors on login, blocking all operations.',
    reason:   'Message contains outage and error keywords combined with urgency indicators, escalating priority to critical.',
    customer: { name: 'David Park', email: 'd.park@techcorp.io', externalId: 'CORP-4421' },
  },
  {
    message:  'I would like a full refund for my subscription. I signed up last week but the features advertised are not available in my region.',
    channel:  'portal',
    category: 'refund',
    priority: 'high',
    confidence: 0.95,
    summary:  'Customer is requesting a full refund citing geographic feature unavailability shortly after subscribing.',
    reason:   'Message explicitly requests a refund due to product mismatch with advertised features.',
    customer: { name: 'Maria Garcia', email: 'maria.g@personal.net' },
  },
  {
    message:  'It would be really nice if the dashboard had a dark mode and the ability to export reports as CSV. Our whole team has been asking for this.',
    channel:  'api',
    category: 'feature_request',
    priority: 'low',
    confidence: 0.80,
    summary:  'Customer requests dark mode UI and CSV export functionality on behalf of their team.',
    reason:   'Message contains feature and enhancement keywords with no urgency indicators.',
    customer: { name: 'Alex Turner', email: 'alex@designstudio.com' },
  },
  {
    message:  'Hi, I just signed up and I am not sure how to add more team members to my account. Can someone walk me through the steps?',
    channel:  'phone',
    category: 'general_inquiry',
    priority: 'medium',
    confidence: 0.65,
    summary:  'New customer is asking for guidance on how to add team members to their account.',
    reason:   'Message is a straightforward onboarding question with no specific issue or urgency.',
    customer: { name: 'James Wright', email: 'james.wright@startup.co' },
  },
  {
    message:  'Your service is absolutely terrible. I have been waiting 3 days for support and nobody has responded. This is completely unacceptable.',
    channel:  'email',
    category: 'complaint',
    priority: 'high',
    confidence: 0.88,
    summary:  'Customer is expressing strong dissatisfaction over a 3-day unresolved support wait time.',
    reason:   'Message contains explicit complaint and dissatisfaction language indicating poor service experience.',
    customer: { name: 'Emily Chen', email: 'emily.chen@business.org' },
  },
  {
    message:  'My payment failed three times today but your system still shows my account as active. Am I going to lose access? Please help.',
    channel:  'chat',
    category: 'billing',
    priority: 'high',
    confidence: 0.91,
    summary:  'Customer reports repeated payment failures and is concerned about losing account access.',
    reason:   'Message combines payment failure keywords with account access concern, indicating a high-priority billing issue.',
    customer: { name: 'Raj Patel', email: 'raj.patel@enterprise.in' },
  },
  {
    message:  'The mobile app keeps crashing whenever I try to open the analytics tab. This bug has been happening for a week on my iPhone 15.',
    channel:  'portal',
    category: 'technical',
    priority: 'high',
    confidence: 0.89,
    summary:  'Customer reports a recurring crash on the analytics tab in the iOS mobile app, persisting for one week.',
    reason:   'Message describes a specific reproducible bug on a known device causing app crashes.',
    customer: { name: 'Lisa Monroe', email: 'l.monroe@freelance.com' },
  },
];

// ── Seed function ─────────────────────────────────────────────────────────────
async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB:', MONGO_URI);

  let created = 0;

  for (const s of SAMPLES) {
    const now        = new Date();
    const resolvedAt = new Date(now.getTime() - Math.random() * 3600000); // resolved 0-60 min ago

    // 1. Create the CustomerRequest
    const req = await Request.create({
      originalMessage:  s.message,
      sourceChannel:    s.channel,
      status:           'completed',
      categorySnapshot: s.category,
      prioritySnapshot: s.priority,
      customer:         s.customer,
      resolvedAt,
      metadata:         { seeded: true },
    });

    // 2. Create AIClassification document
    const cls = await AIClass.create({
      requestId:    req._id,
      provider:     'mock',
      category:     s.category,
      priority:     s.priority,
      summary:      s.summary,
      confidence:   s.confidence,
      reason:       s.reason,
      modelVersion: 'mock-keyword-v1',
      latencyMs:    Math.floor(Math.random() * 80) + 20,
      rawOutput:    { category: s.category, priority: s.priority, confidence: s.confidence },
      errorState:   { isError: false },
    });

    // 3. Back-link classification to request
    await Request.findByIdAndUpdate(req._id, { classificationId: cls._id });

    // 4. Write audit events
    await Event.insertMany([
      { requestId: req._id, eventType: 'request_created',            oldValue: null,        newValue: { status: 'queued' },     actor: { actorType: 'api',    label: 'seed-script' }, metadata: {} },
      { requestId: req._id, eventType: 'status_changed',             oldValue: 'queued',    newValue: 'processing',             actor: { actorType: 'system', label: 'seed-script' }, metadata: {} },
      { requestId: req._id, eventType: 'ai_classification_completed', oldValue: null,        newValue: { category: s.category, priority: s.priority, confidence: s.confidence }, actor: { actorType: 'system', label: 'seed-script' }, metadata: { provider: 'mock' } },
      { requestId: req._id, eventType: 'category_changed',           oldValue: null,        newValue: s.category,               actor: { actorType: 'system', label: 'seed-script' }, metadata: {} },
      { requestId: req._id, eventType: 'priority_changed',           oldValue: null,        newValue: s.priority,               actor: { actorType: 'system', label: 'seed-script' }, metadata: {} },
      { requestId: req._id, eventType: 'status_changed',             oldValue: 'processing',newValue: 'completed',              actor: { actorType: 'system', label: 'seed-script' }, metadata: {} },
      { requestId: req._id, eventType: 'request_resolved',           oldValue: null,        newValue: null,                     actor: { actorType: 'system', label: 'seed-script' }, metadata: { resolvedAt } },
    ]);

    console.log(`  ✓ [${s.priority.toUpperCase().padEnd(8)}] ${s.category.padEnd(16)} — "${s.message.slice(0, 55)}…"`);
    created++;
  }

  console.log(`\n🎉 Seeded ${created} fully-classified requests. Refresh your dashboard!\n`);
  await mongoose.disconnect();
}

seed().catch((err) => { console.error('Seed failed:', err.message); process.exit(1); });
