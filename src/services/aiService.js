/**
 * @file aiService.js  (src/services)
 * @description AI Classification Service — Strategy / Adapter Pattern.
 *
 * Provider selection at startup (priority order):
 *   1. OpenAI   — when OPENAI_API_KEY is present
 *   2. Gemini   — when GEMINI_API_KEY is present
 *   3. Mock     — deterministic keyword-intent matching (always available)
 *
 * Every provider implements the same interface:
 *   classify({ message: string, channel: string })
 *   → Promise<{ category, priority, summary, confidence, reason }>
 *
 * The AIService wrapper adds timing, provider name, and a model version
 * field so the caller can persist a complete AIClassification document.
 *
 * USAGE:
 *   import aiService from '../services/aiService.js';
 *   const result = await aiService.classify({ requestId, message, channel });
 */

// ── Shared classification output schema ──────────────────────────────────────

/**
 * @typedef {Object} ClassificationResult
 * @property {string}      category    - one of AI_CATEGORIES values
 * @property {string}      priority    - one of AI_PRIORITIES values
 * @property {string}      summary     - 1-3 sentence plain-English summary
 * @property {number}      confidence  - float in [0, 1]
 * @property {string}      reason      - human-readable rationale
 * @property {string}      provider    - 'openai' | 'gemini' | 'mock'
 * @property {string|null} modelVersion
 * @property {number}      latencyMs
 */

// ── Keyword rules for the Mock provider ──────────────────────────────────────

const URGENCY_KEYWORDS = [
  'urgent', 'asap', 'immediately', 'emergency', 'critical',
  'right now', 'right away', 'cannot wait',
];

/**
 * Each rule is evaluated in order; the first match wins.
 * `keywords` are matched case-insensitively against the raw message.
 */
const KEYWORD_RULES = [
  {
    category:   'refund',
    priority:   'high',
    confidence: 0.95,
    keywords:   ['refund', 'money back', 'return my money', 'reimburse', 'reimbursement'],
    reason:     'Message explicitly requests a refund or reimbursement.',
  },
  {
    category:   'billing',
    priority:   'high',
    confidence: 0.92,
    keywords:   ['payment', 'charge', 'charged', 'invoice', 'bill', 'billing',
                 'subscription', 'fee', 'cost', 'price', 'overcharged', 'double charge'],
    reason:     'Message contains financial or billing-related terminology.',
  },
  {
    category:   'technical',
    priority:   'high',
    confidence: 0.89,
    keywords:   ['crash', 'bug', 'error', 'broken', 'not working', "doesn't work",
                 "doesn't load", 'issue', 'glitch', 'fail', 'failed', 'outage',
                 'down', 'cannot access', "can't access", 'login problem',
                 'password reset', '500', '404', 'exception'],
    reason:     'Message describes a technical malfunction or service disruption.',
  },
  {
    category:   'complaint',
    priority:   'high',
    confidence: 0.85,
    keywords:   ['complaint', 'complain', 'unhappy', 'terrible', 'disappointed',
                 'worst', 'awful', 'disgusted', 'frustrated', 'angry',
                 'unacceptable', 'poor service', 'bad experience'],
    reason:     'Message expresses explicit dissatisfaction or lodges a complaint.',
  },
  {
    category:   'feature_request',
    priority:   'low',
    confidence: 0.80,
    keywords:   ['feature', 'suggestion', 'would be nice', 'could you add',
                 'please add', 'enhancement', 'improve', 'wish', 'wishlist',
                 'roadmap', 'idea'],
    reason:     'Message requests a new capability or improvement to the product.',
  },
];

const DEFAULT_RULE = {
  category:   'general_inquiry',
  priority:   'medium',
  confidence: 0.65,
  reason:     'No specific intent detected; classified as a general inquiry.',
};

// ── Base provider (abstract interface) ───────────────────────────────────────

class AIProvider {
  /** @type {string} */
  name = 'base';
  /** @type {string|null} */
  modelVersion = null;

  /**
   * @param {{ message: string, channel: string }} params
   * @returns {Promise<Omit<ClassificationResult, 'provider'|'modelVersion'|'latencyMs'>>}
   */
  // eslint-disable-next-line no-unused-vars
  async classify(_params) {
    throw new Error(`classify() must be implemented by ${this.constructor.name}`);
  }
}

// ── Mock Provider ─────────────────────────────────────────────────────────────

class MockAIProvider extends AIProvider {
  name         = 'mock';
  modelVersion = 'mock-keyword-v1';

  async classify({ message }) {
    const text = message.toLowerCase();

    // Detect urgency override
    const isUrgent = URGENCY_KEYWORDS.some((kw) => text.includes(kw));

    // Find first matching keyword rule
    let matched = null;
    for (const rule of KEYWORD_RULES) {
      if (rule.keywords.some((kw) => text.includes(kw))) {
        matched = rule;
        break;
      }
    }

    const rule    = matched ?? DEFAULT_RULE;
    const priority = isUrgent ? 'critical' : rule.priority;

    // Build a brief summary from the first 120 characters of the message
    const excerpt  = message.length > 120 ? `${message.slice(0, 120)}…` : message;
    const summary  = `Customer submitted a ${rule.category.replace('_', ' ')} request`
                   + (isUrgent ? ' marked as urgent' : '')
                   + `. Excerpt: "${excerpt}"`;

    // Slight confidence boost when urgency is detected (model is more certain)
    const confidence = isUrgent
      ? Math.min(rule.confidence + 0.04, 1.0)
      : rule.confidence;

    return {
      category:   rule.category,
      priority,
      summary,
      confidence: parseFloat(confidence.toFixed(2)),
      reason:     isUrgent
        ? `${rule.reason} Urgency keywords detected — priority escalated to 'critical'.`
        : rule.reason,
    };
  }
}

// ── OpenAI Provider ───────────────────────────────────────────────────────────

const CLASSIFICATION_SYSTEM_PROMPT = `You are a customer support triage AI.
Analyze the customer message and respond with ONLY a valid JSON object.
Choose 'category' from: billing, technical, general_inquiry, complaint, feature_request, refund, other.
Choose 'priority' from: low, medium, high, critical.
Return exactly this shape:
{
  "category":   "<string>",
  "priority":   "<string>",
  "summary":    "<1-3 sentence plain English summary of the customer's issue>",
  "confidence": <float between 0.0 and 1.0>,
  "reason":     "<brief explanation of why you chose this category and priority>"
}`;

class OpenAIProvider extends AIProvider {
  name         = 'openai';
  modelVersion = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  /** @param {string} apiKey */
  constructor(apiKey) {
    super();
    this._apiKey = apiKey;
    // Lazy-loaded to avoid hard import errors when package is absent
    this._client = null;
  }

  async _getClient() {
    if (this._client) return this._client;
    // Dynamic import — only runs if provider is actually selected
    const { default: OpenAI } = await import('openai');
    this._client = new OpenAI({ apiKey: this._apiKey });
    return this._client;
  }

  async classify({ message, channel }) {
    const client = await this._getClient();

    const completion = await client.chat.completions.create({
      model:           this.modelVersion,
      temperature:     0,           // deterministic output for classification
      max_tokens:      512,
      response_format: { type: 'json_object' }, // guaranteed JSON
      messages: [
        { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
        {
          role:    'user',
          content: `Channel: ${channel}\n\nCustomer message:\n${message}`,
        },
      ],
    });

    const raw  = completion.choices[0].message.content;
    const data = JSON.parse(raw);

    return {
      category:   data.category,
      priority:   data.priority,
      summary:    data.summary,
      confidence: parseFloat((data.confidence ?? 0.8).toFixed(2)),
      reason:     data.reason,
    };
  }
}

// ── Gemini Provider ───────────────────────────────────────────────────────────

class GeminiProvider extends AIProvider {
  name         = 'gemini';
  modelVersion = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';

  /** @param {string} apiKey */
  constructor(apiKey) {
    super();
    this._apiKey = apiKey;
    this._model  = null;
  }

  async _getModel() {
    if (this._model) return this._model;
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI      = new GoogleGenerativeAI(this._apiKey);
    this._model      = genAI.getGenerativeModel({
      model:            this.modelVersion,
      generationConfig: {
        responseMimeType: 'application/json', // structured JSON output
        temperature:       0,
        maxOutputTokens:   512,
      },
    });
    return this._model;
  }

  async classify({ message, channel }) {
    const model = await this._getModel();

    const prompt = [
      CLASSIFICATION_SYSTEM_PROMPT,
      '',
      `Channel: ${channel}`,
      '',
      `Customer message:\n${message}`,
    ].join('\n');

    const result   = await model.generateContent(prompt);
    const raw      = result.response.text();
    const data     = JSON.parse(raw);

    return {
      category:   data.category,
      priority:   data.priority,
      summary:    data.summary,
      confidence: parseFloat((data.confidence ?? 0.8).toFixed(2)),
      reason:     data.reason,
    };
  }
}

// ── AIService (Strategy orchestrator) ─────────────────────────────────────────

class AIService {
  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this._provider = new OpenAIProvider(process.env.OPENAI_API_KEY);
      console.info('[AIService] Provider selected: OpenAI');
    } else if (process.env.GEMINI_API_KEY) {
      this._provider = new GeminiProvider(process.env.GEMINI_API_KEY);
      console.info('[AIService] Provider selected: Gemini');
    } else {
      this._provider = new MockAIProvider();
      console.info('[AIService] No API key found — using deterministic Mock provider');
    }
  }

  /** Provider name string for persistence */
  get providerName() {
    return this._provider.name;
  }

  /** Model version string for persistence */
  get modelVersion() {
    return this._provider.modelVersion;
  }

  /**
   * Classify a customer message.
   *
   * @param {{ requestId: string, message: string, channel: string }} params
   * @returns {Promise<ClassificationResult>}
   * @throws Will re-throw provider errors so the worker can handle retries.
   */
  async classify({ requestId, message, channel }) {
    const t0 = Date.now();

    const result = await this._provider.classify({ message, channel });

    return {
      ...result,
      provider:     this._provider.name,
      modelVersion: this._provider.modelVersion,
      latencyMs:    Date.now() - t0,
    };
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────
// Instantiated once at module load so provider selection happens at startup.
const aiService = new AIService();
export default aiService;
