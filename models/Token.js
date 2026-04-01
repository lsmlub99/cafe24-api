import mongoose from 'mongoose';

const tokenSchema = new mongoose.Schema({
  mall_id: { type: String, required: true, unique: true },
  accessToken: { type: String, required: true },
  refreshToken: { type: String, required: true },
  expiresAt: { type: String }
}, { timestamps: true });

export default mongoose.model('Token', tokenSchema);
