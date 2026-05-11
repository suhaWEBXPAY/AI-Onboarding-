require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const merchantTypeRoutes = require('./routes/merchantTypeRoutes');
const requirementRoutes = require('./routes/requirementRoutes');
const onboardVerificationRoutes = require('./routes/onboardVerificationRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/merchant-types', merchantTypeRoutes);
app.use('/api/requirements', requirementRoutes);
app.use('/api/onboard-verification', onboardVerificationRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'AI-Onboarding-V2 API is running.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
