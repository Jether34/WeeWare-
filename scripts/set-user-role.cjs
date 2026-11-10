// Local operator command: node scripts/set-user-role.cjs <email> <farmer|researcher|admin|da>
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../backend/.env') });
const User = require('../backend/src/models/User');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const role = String(process.argv[3] || '').trim().toLowerCase();
  if (!email || !['farmer', 'researcher', 'admin', 'da'].includes(role)) {
    throw new Error('Usage: node scripts/set-user-role.cjs <existing-account-email> <farmer|researcher|admin|da>');
  }
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/weeware');
  const user = await User.findOneAndUpdate({ email }, { role }, { new: true, runValidators: true }).select('fullName email role');
  if (!user) throw new Error(`No account found for ${email}. Create the account first, then assign its role.`);
  console.log(`Role assigned: ${user.fullName} (${user.email}) → ${user.role}`);
  await mongoose.disconnect();
}

main().catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });
