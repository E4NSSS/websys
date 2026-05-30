import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/artopia_db";
let dbConnected = false;

// Shared fallback memory store
const fallbackProgressData = {
  user_allan_hortiz: {
    totalCount: 5,
    lessonProgress: {
      Progress_LineTracing_intro: 0, Progress_LineTracing_technique: 0, Progress_LineTracing_advanced: 0,
      Progress_StrokeControl_intro: 0, Progress_StrokeControl_technique: 0, Progress_StrokeControl_advanced: 0,
      Progress_Drawing_intro: 0, Progress_Drawing_technique: 0, Progress_Drawing_advanced: 0,
      Progress_Shapes_intro: 0, Progress_Shapes_technique: 0, Progress_Shapes_advanced: 0,
      Progress_Shading_intro: 0, Progress_Shading_technique: 0, Progress_Shading_advanced: 0,
    }
  }
};

const cleanKey = (name = '') => String(name).replace(/\s+/g, '');

// Central processing calculator: counts 1s per sublesson block and builds parent score map
const aggregateParentLessons = (rawProgressMap = {}) => {
  const target = rawProgressMap instanceof Map ? Object.fromEntries(rawProgressMap) : rawProgressMap;
  const standardLessons = ["LineTracing", "StrokeControl", "Drawing", "Shapes", "Shading"];
  
  const calculatedLessons = {};
  let totalFinishedLessons = 0;

  standardLessons.forEach((lesson) => {
    const introVal = Number(target[`Progress_${lesson}_intro`] ?? 0);
    const techVal = Number(target[`Progress_${lesson}_technique`] ?? 0);
    const advVal = Number(target[`Progress_${lesson}_advanced`] ?? 0);

    // Sum up completed values. If all 3 are watched, cumulativeScore becomes 3
    const cumulativeScore = introVal + techVal + advVal;
    calculatedLessons[`Progress_${lesson}`] = cumulativeScore;

    if (cumulativeScore === 3) {
      totalFinishedLessons += 1;
    }
  });

  return {
    finishedCount: totalFinishedLessons,
    lessonProgress: calculatedLessons
  };
};

mongoose.connect(MONGO_URI)
  .then(() => { dbConnected = true; console.log("Connected to MongoDB."); })
  .catch((err) => { console.error("Database error:", err); });

const progressSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  totalCount: { type: Number, default: 5 },
  lessonProgress: {
    type: Map,
    of: Number,
    default: () => new Map([
      ['Progress_LineTracing_intro', 0], ['Progress_LineTracing_technique', 0], ['Progress_LineTracing_advanced', 0],
      ['Progress_StrokeControl_intro', 0], ['Progress_StrokeControl_technique', 0], ['Progress_StrokeControl_advanced', 0],
      ['Progress_Drawing_intro', 0], ['Progress_Drawing_technique', 0], ['Progress_Drawing_advanced', 0],
      ['Progress_Shapes_intro', 0], ['Progress_Shapes_technique', 0], ['Progress_Shapes_advanced', 0],
      ['Progress_Shading_intro', 0], ['Progress_Shading_technique', 0], ['Progress_Shading_advanced', 0]
    ])
  },
});

const Progress = mongoose.model('Progress', progressSchema);

const sendCalculatedPayload = (res, totalCount, rawProgressMap) => {
  const calculations = aggregateParentLessons(rawProgressMap);
  return res.json({
    finishedCount: calculations.finishedCount,
    totalCount: totalCount ?? 5,
    lessonProgress: calculations.lessonProgress,
  });
};

app.get('/api/progress/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!dbConnected) {
      const fallback = fallbackProgressData[userId] || { totalCount: 5, lessonProgress: {} };
      return sendCalculatedPayload(res, fallback.totalCount, fallback.lessonProgress);
    }

    let userProgress = await Progress.findOne({ userId });
    if (!userProgress) {
      userProgress = new Progress({ userId, totalCount: 5 });
      await userProgress.save();
    }
    return sendCalculatedPayload(res, userProgress.totalCount, userProgress.lessonProgress);
  } catch (error) {
    return res.status(500).json({ error: "Database Lookup Error" });
  }
});

app.post('/api/progress/update', async (req, res) => {
  try {
    const { userId, lessonName, subLessonType } = req.body;
    if (!userId || !lessonName || !subLessonType) {
      return res.status(400).json({ error: 'Missing parameter entries.' });
    }

    const baseKey = cleanKey(lessonName);
    let subTypeSuffix = 'intro';
    if (subLessonType.toLowerCase().includes('tech')) subTypeSuffix = 'technique';
    if (subLessonType.toLowerCase().includes('adv')) subTypeSuffix = 'advanced';

    const targetSubKey = `Progress_${baseKey}_${subTypeSuffix}`;

    if (!dbConnected) {
      if (!fallbackProgressData[userId]) {
        fallbackProgressData[userId] = { totalCount: 5, lessonProgress: {} };
      }
      fallbackProgressData[userId].lessonProgress[targetSubKey] = 1;
      return sendCalculatedPayload(res, fallbackProgressData[userId].totalCount, fallbackProgressData[userId].lessonProgress);
    }

    let currentProgress = await Progress.findOne({ userId });
    if (!currentProgress) {
      currentProgress = new Progress({ userId, totalCount: 5 });
    }

    // Explicitly write a 1 to confirm this sub-lesson block has been fully satisfied
    currentProgress.lessonProgress.set(targetSubKey, 1);
    currentProgress.markModified('lessonProgress');
    await currentProgress.save();

    return sendCalculatedPayload(res, currentProgress.totalCount, currentProgress.lessonProgress);
  } catch (error) {
    return res.status(500).json({ error: 'Failed writing progress variables securely.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));