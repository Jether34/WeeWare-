const User = require('../models/User');
const Prediction = require('../models/Prediction');
const SavedPrediction = require('../models/SavedPrediction');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const env = require('../config/env');

const SYSTEM_KNOWLEDGE = `WeeWare system guide:
- WeeWare is a climate-informed research application for mango pulp weevil monitoring across Palawan. Its active stack is React/Vite, Express, MongoDB, a Python FastAPI climate/model service, and Ollama for the in-app assistant.
- Main pages: public landing page and organizational chart; signup/login/password reset; Prediction (map location, 365-day date window, climate extraction, LASSO result, severity and suggested field actions); History and Saved reports; Community forum (search people/posts, profiles, posts, photos/videos, likes, comments and replies); Messages (direct and role group conversations that sync across signed-in devices); AI conversations; Settings; and role dashboards.
- Authentication uses a verified signup email and password-reset flow. Settings hold profile, language and public-profile preferences. The forum supports post review and deletion requests, with administration controls. Signup/device metadata is handled as protected account information.
- Roles: farmer uses prediction, forum, messages, AI and settings. Researcher has system iteration/model retraining and dashboards. Department of Agriculture (DA) has forecast dashboard and messages. Admin manages accounts, moderation, system dashboard and support functions. Role availability can vary with the current deployment.
- Users can manage their own profile and view their own saved prediction history. Admin account management includes editing/removing accounts. Researcher retraining is intended to validate the integrated training format and replace the active LASSO model only after a successful training workflow.
- Messages are stored as readable account conversations and sync across signed-in devices. The AI does not receive message contents. Never claim to have sent a message, edited/deleted an account, changed model settings, or performed an action unless a connected system action explicitly confirms it.
- Prediction uses five annual climate features in model order: rainfall, temperature, relative humidity, solar radiation, and wind speed. The service extracts available CMIP6 or observed weather inputs and labels missing coverage as training-climatology fallback, then runs the Palawan LASSO model. The supported coordinate extent covers Palawan; selected coordinates are not farm-level weather measurements. Treat the estimate as a screening tool, not a field diagnosis.
- The supplied CMIP6 files have incomplete and mixed coverage: rainfall through 2030, temperature/humidity through 2032, wind through 2034, while solar lacks future coverage. Missing dates use a labeled training-climatology fallback. Do not claim that dates after a source file ends are backed by CMIP6 observations.
- Community posts/comments and prediction records are stored in MongoDB. Private messages are deliberately excluded from AI retrieval. AI conversation history belongs to the signed-in account.
- The codebase identifies Jether Garque as a developer in a source-file author comment. No personal biography is documented. The public organizational chart names Ruffa Mae L. Arzaga as research adviser and Gian Bless, Glen Ariona, and Yvez Ashley as student researchers. Do not invent the creator's biography or personal details.
- For account-specific questions, use only the attached account context. For system questions, use this guide and attached live system/model summaries. If facts are missing, say so and ask a focused question.`;

const ACCOUNT_FIELDS = 'fullName email gender birthday address phone language role accountStatus acceptedTerms createdAt profilePicture publicProfile';
const predictionFields = 'title startDate endDate location weather infestationRate riskCategory suggestedAction severityScore createdAt weatherSources';

function asksAboutOwnAccount(message) {
  return /\b(my|mine|me|myself|my account|my profile|my records|my predictions|my reports|my posts|my activity|my signup|my sign-up)\b|\bwhat (?:is|are) my\b/i.test(message);
}

function asksForPredictions(message) {
  return /\b(prediction|predictions|forecast|forecasts|saved report|saved reports|infestation history)\b/i.test(message);
}

function asksForForumRecords(message) {
  return /\b(my posts|my comments|my forum|my activity|forum posts|comments I|posts I)\b/i.test(message);
}

function asksForSignupMetadata(message) {
  return /\b(ip address|signup ip|sign-up ip|device (?:details|specs|information)|browser details|signup location|sign-up location|signup coordinates|signup time|registration time)\b/i.test(message);
}

function extractAccountQuery(message) {
  const email = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) return { email: email.toLowerCase() };
  const patterns = [
    /\b(?:email|phone(?: number)?|address|birthday|role|account status|signup details|sign-up details|ip address|device details)\s+(?:for|of|about)\s+(.{3,100})$/i,
    /\b(?:what is|what's|show me|tell me)\s+(.{3,100}?)['â€™]s\s+(?:email|phone(?: number)?|address|birthday|role|account status)\b/i,
    /\b(?:find|lookup|look up|search for|show(?: me)?|check|inspect|fetch|retrieve|tell me about|details for|details about|information for|information about|profile for|profile of|account for)\s+(?:the\s+)?(?:user|account|profile|record|details|information)?\s*(?:named\s+)?(.{3,100})$/i,
    /\b(?:who is|who's)\s+(.{3,100})$/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const query = match[1].replace(/[?.,;]+$/, '').replace(/\b(?:user|account|profile|records?|details|information)\b/gi, '').replace(/^(?:for|about|of|named)\s+/i, '').trim();
      if (query.length >= 3) return { name: query };
    }
  }
  return null;
}

function jsonBlock(label, value) {
  return `${label}:\n${JSON.stringify(value, null, 2)}`;
}

async function readModelSummary() {
  try {
    const response = await fetch(`${env.mlServiceUrl}/model/info`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { status: 'Model information service unavailable.' };
    const info = await response.json();
    const safe = {};
    for (const key of ['model', 'model_name', 'features', 'feature_names', 'alpha', 'coefficients', 'intercept', 'training_rows', 'training_years', 'metrics', 'status', 'version']) {
      if (info[key] !== undefined) safe[key] = info[key];
    }
    return Object.keys(safe).length ? safe : { status: info.status || 'Model service responded; no summary fields were available.' };
  } catch {
    return { status: 'Model information service unavailable.' };
  }
}

async function readPersonalContext(userId, message) {
  const blocks = [];
  let directAnswer = '';
  const requestsAccount = asksAboutOwnAccount(message);
  const requestsPredictions = asksForPredictions(message);
  const requestsForum = asksForForumRecords(message);
  if (!requestsAccount && !requestsPredictions && !requestsForum) return { blocks, directAnswer };

  const user = await User.findById(userId).select(ACCOUNT_FIELDS).lean();
  if (!user) return { blocks: ['The current signed-in account record was not found.'], directAnswer };
  if (requestsAccount) {
    const account = {
      fullName: user.fullName, email: user.email, role: user.role, accountStatus: user.accountStatus,
      gender: user.gender || null, birthday: user.birthday || null, address: user.address || null,
      phone: user.phone || null, language: user.language, acceptedTerms: user.acceptedTerms,
      createdAt: user.createdAt, profilePicture: user.profilePicture || null,
      publicProfilePreferences: user.publicProfile || {},
    };
    if (asksForSignupMetadata(message)) {
      const staffUser = await User.findById(userId).select('signupIp signupDevice signupLocation').lean();
      account.signupIp = staffUser?.signupIp || null;
      account.signupDevice = staffUser?.signupDevice || null;
      account.signupLocation = staffUser?.signupLocation || null;
    }
    blocks.push(jsonBlock("Signed-in user's account record", account));
    if (/\bmy\s+(?:information|details|account|profile|records?)\b/i.test(message)) {
      const fields = [
        ['Full name', account.fullName], ['Email', account.email], ['Role', account.role],
        ['Account status', account.accountStatus], ['Address', account.address], ['Phone', account.phone],
        ['Gender', account.gender], ['Birthday', account.birthday ? new Date(account.birthday).toLocaleDateString('en-US') : null],
        ['Language', account.language], ['Account created', account.createdAt ? new Date(account.createdAt).toLocaleString('en-US') : null],
      ];
      directAnswer = `I checked your WeeWare account record:\n${fields.map(([label, value]) => `${label}: ${value || 'Not provided'}`).join('\n')}`;
      if (account.signupIp !== undefined || account.signupDevice !== undefined || account.signupLocation !== undefined) {
        directAnswer += `\nSignup IP: ${account.signupIp || 'Unavailable'}\nSignup device: ${account.signupDevice?.platform || account.signupDevice?.type || 'Unavailable'}\nSignup location: ${account.signupLocation ? `${account.signupLocation.latitude}, ${account.signupLocation.longitude}` : 'Not shared or unavailable'}`;
      }
    }
  }
  if (requestsPredictions) {
    const [predictions, saved] = await Promise.all([
      Prediction.find({ user: userId }).select(predictionFields).sort({ createdAt: -1 }).limit(8).lean(),
      SavedPrediction.find({ user: userId }).select('title description createdAt prediction').sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    blocks.push(jsonBlock('Signed-in userâ€™s recent prediction records (up to 8)', predictions));
    blocks.push(jsonBlock('Signed-in userâ€™s saved report records (up to 8)', saved));
  }
  if (requestsForum) {
    const [posts, comments] = await Promise.all([
      Post.find({ author: userId, deletedAt: null }).select('content publishStatus createdAt media likes').sort({ createdAt: -1 }).limit(8).lean(),
      Comment.find({ author: userId, deletedAt: null }).select('content post createdAt likes').sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    blocks.push(jsonBlock('Signed-in userâ€™s recent forum posts (up to 8)', posts));
    blocks.push(jsonBlock('Signed-in userâ€™s recent forum comments (up to 8)', comments));
  }
  return { blocks, directAnswer };
}

async function readAdminAccountLookup(message, history = [], actorId) {
  const emailLookup = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(message);
  const explicitAccountLookup = /\b(?:find|lookup|look up|search for|show(?: me)?|check|inspect|fetch|retrieve|tell me about)\s+(?:the\s+)?(?:user|account|profile|record)\b|\b(?:details|information|profile|account|record|email|phone|address|birthday|role|signup details|sign-up details|ip address|device details)\s+(?:for|about|of)\b|\bwho is\b|\b(?:what is|what's)\s+.{3,80}['â€™]s\s+(?:email|phone|address|birthday|role|account status)\b/i.test(message);
  const generalNameLookup = /\b(?:find|lookup|look up|search for|show(?: me)?|check|inspect|fetch|retrieve|tell me about)\b/i.test(message)
    && !/\b(?:weevil|mango|weather|climate|model|lasso|forecast|prediction|forum|messages|system|settings|signup|sign-up|training|dataset|page|feature)\b/i.test(message);
  const directLookup = emailLookup || explicitAccountLookup || generalNameLookup;
  const followUpLookup = /\b(their|his|her|them|that user|that account|this account|same user)\b/i.test(message);
  if (!directLookup && !followUpLookup && !/\b(all users|every user|list users|user list|all accounts)\b/i.test(message)) return [];
  const searchText = [message, ...history.slice(-4).filter((item) => item.role === 'user').map((item) => item.text)].join(' ');
  const accountQuery = extractAccountQuery(searchText);
  if (!accountQuery) {
    if (/\b(all users|every user|list users|user list|all accounts)\b/i.test(message)) {
      const count = await User.countDocuments();
      return [jsonBlock('Account lookup result', { totalAccounts: count, note: 'For privacy, identify a specific account by email address or full name. Bulk personal record exports are not provided through chat.' })];
    }
    return [];
  }
  const filter = accountQuery.email ? { email: accountQuery.email } : { fullName: { $regex: accountQuery.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } };
  const users = await User.find(filter).select(`${ACCOUNT_FIELDS} signupIp signupDevice signupLocation`).limit(5).lean();
  if (!users.length) return [`No account matched ${accountQuery.email || accountQuery.name}. Ask for a valid email address or full name.`];
  const sensitive = asksForSignupMetadata(message);
  const records = users.map((user) => ({
    fullName: user.fullName, email: user.email, role: user.role, accountStatus: user.accountStatus,
    gender: user.gender || null, birthday: user.birthday || null, address: user.address || null,
    phone: user.phone || null, language: user.language, acceptedTerms: user.acceptedTerms,
    createdAt: user.createdAt, profilePicture: user.profilePicture || null,
    publicProfilePreferences: user.publicProfile || {},
    ...(sensitive ? { signupIp: user.signupIp || null, signupDevice: user.signupDevice || null, signupLocation: user.signupLocation || null } : {}),
  }));
  const extra = [];
  for (const user of users) {
    const [predictions, posts] = await Promise.all([
      Prediction.find({ user: user._id }).select(predictionFields).sort({ createdAt: -1 }).limit(5).lean(),
      Post.find({ author: user._id, deletedAt: null }).select('content publishStatus createdAt').sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    extra.push({ account: user.email, predictions, forumPosts: posts });
  }
  console.info('[ai] administrator account lookup', JSON.stringify({ actorId: String(actorId), targetIds: users.map((user) => String(user._id)), at: new Date().toISOString() }));
  return [jsonBlock('Administrator-authorized account record lookup (up to 5 exact/name matches)', records), jsonBlock('Matching accountâ€™s recent prediction and forum-post records', extra)];
}

async function readStaffSystemContext(role, message) {
  const blocks = [];
  if (['admin', 'researcher'].includes(role)) {
    blocks.push(jsonBlock('Live LASSO model summary', await readModelSummary()));
  }
  if (role === 'admin' && /\b(user|users|account|accounts|dashboard|statistics|system status|how many|count|forum|post|comment|prediction)\b/i.test(message)) {
    const [roleCounts, predictions, posts, comments] = await Promise.all([
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      Prediction.countDocuments(), Post.countDocuments({ deletedAt: null }), Comment.countDocuments({ deletedAt: null }),
    ]);
    blocks.push(jsonBlock('Live administrator dashboard counts', { accountsByRole: roleCounts, predictions, publishedAndPendingPosts: posts, activeComments: comments }));
  }
  if (['da', 'admin'].includes(role) && /\b(prediction|forecast|infestation|risk|dashboard|recent)\b/i.test(message)) {
    const forecasts = await Prediction.find().select('startDate endDate location infestationRate riskCategory suggestedAction createdAt').sort({ createdAt: -1 }).limit(8).lean();
    blocks.push(jsonBlock('Recent system forecasts (without account identities)', forecasts));
  }
  return blocks;
}

async function buildAssistantContext({ userId, role, message, history }) {
  const blocks = [`System knowledge:\n${SYSTEM_KNOWLEDGE}`];
  const personal = await readPersonalContext(userId, message);
  blocks.push(...personal.blocks);
  if (role === 'admin') blocks.push(...await readAdminAccountLookup(message, history, userId));
  blocks.push(...await readStaffSystemContext(role, message));
  return { context: `Current signed-in role: ${role}.\n\n${blocks.join('\n\n')}`.slice(0, 18000), directAnswer: personal.directAnswer };
}

module.exports = { buildAssistantContext };

