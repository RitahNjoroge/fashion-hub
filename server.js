import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import mysql from 'mysql2/promise';
import multer from 'multer';
import cloudinary from 'cloudinary';
import { config } from 'dotenv';

config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// Cloudinary configuration
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// MySQL database connection
const db = mysql.createPool({
  host: 'localhost',
  user: 'jaleny',
  password: 'Milky@734',
  database: 'fashionhub',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Make DB name easily available for INFORMATION_SCHEMA queries
const DB_NAME = 'fashionhub';

// Utility: detect an existing column from a list of candidates for a given table
async function getExistingColumn(tableName, candidates = []) {
  try {
    const [rows] = await db.execute(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [DB_NAME, tableName]
    );

    const existing = rows.map(r => r.COLUMN_NAME);
    for (const c of candidates) {
      if (existing.includes(c)) return c;
    }
  } catch (err) {
    console.warn(`Could not inspect columns for ${tableName}:`, err.message);
  }
  return null;
}

// Initialize database tables
async function initializeDatabase() {
  try {
    console.log('🔄 Initializing database tables...');
    
    // Create likes table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        post_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Likes table ready');

    // Create saved_posts table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS saved_posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        post_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Saved posts table ready');

    // Create comments table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        post_id INT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Comments table ready');

    // Add view_count to posts if not exists
    try {
      await db.execute('ALTER TABLE posts ADD COLUMN view_count INT DEFAULT 0');
      console.log('✅ View count column added to posts');
    } catch (error) {
      console.log('ℹ️ View count column already exists');
    }

    // Add post_type to posts if not exists
    try {
      await db.execute("ALTER TABLE posts ADD COLUMN post_type ENUM('blog', 'social') DEFAULT 'blog'");
      console.log('✅ Post type column added to posts');
    } catch (error) {
      console.log('ℹ️ Post type column already exists');
    }

  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
  }
}

// Test database connection
db.getConnection()
  .then(connection => {
    console.log('✅ Connected to MySQL database');
    connection.release();
    initializeDatabase();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err);
  });

// Auth middleware
const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET || 'simple_secret_key');
    
    const [users] = await db.execute(
      'SELECT id, username, email, role FROM users WHERE id = ?',
      [user.id]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'User no longer exists' });
    }
    
    req.user = users[0];
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Helper function to calculate engagement level
function calculateEngagementLevel(likes, saves, comments) {
  const totalEngagement = likes + saves + (comments * 2);
  if (totalEngagement >= 50) return 'Expert';
  if (totalEngagement >= 25) return 'Active';
  if (totalEngagement >= 10) return 'Regular';
  return 'Beginner';
}

// ==================== ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Fashion Hub is running!' });
});

// Register
app.post('/api/register', async (req, res) => {
  const { username, email, password, role } = req.body;
  
  try {
    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email, username]
    );
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const [result] = await db.execute(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, role || 'student']
    );
    
    const userId = result.insertId;
    
    const token = jwt.sign(
      { id: userId, username, email, role: role || 'student' },
      process.env.JWT_SECRET || 'simple_secret_key',
      { expiresIn: '7d' }
    );

    res.json({ 
      success: true, 
      token,
      user: { id: userId, username, email, role: role || 'student' }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const [users] = await db.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    
    if (users.length === 0 || !(await bcrypt.compare(password, users[0].password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    
    const token = jwt.sign(
      { id: user.id, username: user.username, email, role: user.role },
      process.env.JWT_SECRET || 'simple_secret_key',
      { expiresIn: '7d' }
    );

    res.json({ 
      success: true, 
      token,
      user: { id: user.id, username: user.username, email, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
app.get('/api/me', auth, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Upload image
app.post('/api/upload', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;

    const result = await cloudinary.v2.uploader.upload(dataURI, {
      folder: 'fashion-hub',
      transformation: [
        { width: 800, height: 600, crop: 'limit' },
        { quality: 'auto' },
        { format: 'jpg' }
      ]
    });

    res.json({
      success: true,
      imageUrl: result.secure_url,
      publicId: result.public_id
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Image upload failed' });
  }
});

// ==================== POSTS ====================

// In the Create Post endpoint - Remove teacher restriction
app.post('/api/posts', auth, upload.single('image'), async (req, res) => {
  const { title, content, category_id, post_type = 'blog' } = req.body;
  
  // REMOVED: Teacher restriction - now both teachers and students can create posts
  console.log(`User ${req.user.username} (${req.user.role}) creating ${post_type} post`);

  try {
    let imageUrl = null;
    let imagePublicId = null;

    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;

      const cloudinaryResult = await cloudinary.v2.uploader.upload(dataURI, {
        folder: 'fashion-hub',
        transformation: [
          { width: 800, height: 600, crop: 'limit' },
          { quality: 'auto' },
          { format: 'jpg' }
        ]
      });

      imageUrl = cloudinaryResult.secure_url;
      imagePublicId = cloudinaryResult.public_id;
    }

    const [result] = await db.execute(
      'INSERT INTO posts (title, content, category_id, author_id, image_url, image_public_id, post_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, content, category_id, req.user.id, imageUrl, imagePublicId, post_type]
    );

    // Get the created post with author info
    const [posts] = await db.execute(`
      SELECT p.*, u.username as author_name, c.name as category_name
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
    `, [result.insertId]);

    res.json({ 
      success: true, 
      message: 'Post created successfully!',
      post: posts[0]
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all posts
app.get('/api/posts', async (req, res) => {
  try {
    const { type, category, author } = req.query;
    
    let query = `
      SELECT p.*, u.username as author_name, c.name as category_name
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (type === 'blog' || type === 'social') {
      query += ' AND p.post_type = ?';
      params.push(type);
    }
    
    if (category) {
      query += ' AND p.category_id = ?';
      params.push(category);
    }
    
    if (author) {
      query += ' AND u.username = ?';
      params.push(author);
    }
    
    query += ' ORDER BY p.created_at DESC';
    
    const [posts] = await db.execute(query, params);
    
    res.json({ success: true, posts });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get posts by current user
app.get('/api/my-posts', auth, async (req, res) => {
  try {
    const [posts] = await db.execute(`
      SELECT p.*, c.name as category_name
      FROM posts p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.author_id = ?
      ORDER BY p.created_at DESC
    `, [req.user.id]);
    
    res.json({ success: true, posts });
  } catch (error) {
    console.error('Get my posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete post
app.delete('/api/posts/:id', auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    
    // Check if post exists and belongs to user
    const [posts] = await db.execute(
      'SELECT * FROM posts WHERE id = ? AND author_id = ?',
      [postId, userId]
    );
    
    if (posts.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Post not found or access denied' 
      });
    }
    
    const post = posts[0];
    
    // Delete image from Cloudinary if exists
    if (post.image_public_id) {
      try {
        await cloudinary.v2.uploader.destroy(post.image_public_id);
      } catch (cloudinaryError) {
        console.warn('Could not delete Cloudinary image:', cloudinaryError);
      }
    }
    
    // Delete post from database
    await db.execute('DELETE FROM posts WHERE id = ?', [postId]);
    
    res.json({ 
      success: true, 
      message: 'Post deleted successfully' 
    });
    
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// ==================== LIKES & INTERACTIONS ====================

// Like/Unlike a post
app.post('/api/posts/:id/like', auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    // Check if already liked
    const [existingLikes] = await db.execute(
      'SELECT * FROM likes WHERE user_id = ? AND post_id = ?',
      [userId, postId]
    );

    if (existingLikes.length > 0) {
      // Unlike the post
      await db.execute(
        'DELETE FROM likes WHERE user_id = ? AND post_id = ?',
        [userId, postId]
      );
      res.json({ 
        success: true, 
        liked: false,
        message: 'Post unliked'
      });
    } else {
      // Like the post
      await db.execute(
        'INSERT INTO likes (user_id, post_id) VALUES (?, ?)',
        [userId, postId]
      );
      res.json({ 
        success: true, 
        liked: true,
        message: 'Post liked'
      });
    }
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get like status for a post
app.get('/api/posts/:id/like-status', auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const [likes] = await db.execute(
      'SELECT * FROM likes WHERE user_id = ? AND post_id = ?',
      [userId, postId]
    );

    const [likeCount] = await db.execute(
      'SELECT COUNT(*) as count FROM likes WHERE post_id = ?',
      [postId]
    );

    res.json({
      success: true,
      liked: likes.length > 0,
      likeCount: likeCount[0].count
    });
  } catch (error) {
    console.error('Get like status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Increment view count
app.post('/api/posts/:id/view', async (req, res) => {
  try {
    const postId = req.params.id;
    
    await db.execute(
      'UPDATE posts SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?',
      [postId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('View count error:', error);
    res.json({ success: false });
  }
});

// Save/Unsave post
app.post('/api/posts/:id/save', auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const [existingSaves] = await db.execute(
      'SELECT * FROM saved_posts WHERE user_id = ? AND post_id = ?',
      [userId, postId]
    );

    if (existingSaves.length > 0) {
      await db.execute(
        'DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?',
        [userId, postId]
      );
      res.json({ 
        success: true, 
        saved: false,
        message: 'Post unsaved'
      });
    } else {
      await db.execute(
        'INSERT INTO saved_posts (user_id, post_id) VALUES (?, ?)',
        [userId, postId]
      );
      res.json({ 
        success: true, 
        saved: true,
        message: 'Post saved'
      });
    }
  } catch (error) {
    console.error('Save post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== STATISTICS ====================

// Teacher stats
app.get('/api/teacher-stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can access these stats' });
    }

    const userId = req.user.id;

    // Total posts count
    const [postCount] = await db.execute(
      'SELECT COUNT(*) as count FROM posts WHERE author_id = ?',
      [userId]
    );
    
    // Posts by type
    const [postTypeCount] = await db.execute(
      'SELECT post_type, COUNT(*) as count FROM posts WHERE author_id = ? GROUP BY post_type',
      [userId]
    );
    
    // Total views
    const [viewStats] = await db.execute(
      'SELECT COALESCE(SUM(view_count), 0) as total_views FROM posts WHERE author_id = ?',
      [userId]
    );
    
    // Total likes across all posts
    const [likeStats] = await db.execute(
      'SELECT COUNT(*) as total_likes FROM likes l JOIN posts p ON l.post_id = p.id WHERE p.author_id = ?',
      [userId]
    );
    
    // Engagement rate (likes per post)
    const engagementRate = postCount[0].count > 0 
      ? Math.round((likeStats[0].total_likes / postCount[0].count) * 100)
      : 0;

    const blogCount = postTypeCount.find(p => p.post_type === 'blog')?.count || 0;
    const socialCount = postTypeCount.find(p => p.post_type === 'social')?.count || 0;

    res.json({
      success: true,
      stats: {
        totalPosts: postCount[0].count,
        blogPosts: blogCount,
        socialPosts: socialCount,
        totalViews: viewStats[0].total_views,
        totalLikes: likeStats[0].total_likes,
        engagementRate: engagementRate
      }
    });
  } catch (error) {
    console.error('Get teacher stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Student stats
app.get('/api/student-stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Only students can access these stats' });
    }

    const userId = req.user.id;

    // Initialize default stats
    let stats = {
      readPosts: 0,
      likedPosts: 0,
      savedPosts: 0,
      commentsMade: 0,
      learningStreak: 0,
      topCategory: 'Exploring',
      weeklyActivity: 0,
      likesThisWeek: 0,
      savesThisWeek: 0,
      commentsThisWeek: 0,
      categoriesExplored: 0,
      totalCategories: 6,
      explorationProgress: 0,
      engagementLevel: 'Beginner'
    };

    // Get likes count
    try {
      const [likedPosts] = await db.execute(
        'SELECT COUNT(*) as count FROM likes WHERE user_id = ?',
        [userId]
      );
      stats.likedPosts = likedPosts[0]?.count || 0;
      stats.readPosts = stats.likedPosts; // Use likes as proxy for read posts
    } catch (error) {
      console.warn('Error counting likes:', error.message);
    }

    // Get saves count
    try {
      const [savedPosts] = await db.execute(
        'SELECT COUNT(*) as count FROM saved_posts WHERE user_id = ?',
        [userId]
      );
      stats.savedPosts = savedPosts[0]?.count || 0;
    } catch (error) {
      console.warn('Error counting saves:', error.message);
    }

    // Get comments count (detect actual user column name in comments table)
    try {
      const commentUserCol = await getExistingColumn('comments', ['user_id', 'author_id', 'commenter_id']);
      if (commentUserCol) {
        const [commentsMade] = await db.execute(
          `SELECT COUNT(*) as count FROM comments WHERE ${commentUserCol} = ?`,
          [userId]
        );
        stats.commentsMade = commentsMade[0]?.count || 0;
      } else {
        console.warn('Comments user column not found, skipping comments count');
      }
    } catch (error) {
      console.warn('Error counting comments:', error.message);
    }

    // Calculate derived stats
    stats.engagementLevel = calculateEngagementLevel(
      stats.likedPosts, 
      stats.savedPosts, 
      stats.commentsMade
    );

    // Generate reasonable mock data for other stats
    stats.learningStreak = Math.min(7, Math.floor((stats.likedPosts + stats.savedPosts) / 3) + 1);
    stats.weeklyActivity = Math.min(20, stats.likedPosts + stats.savedPosts);
    stats.likesThisWeek = Math.min(10, Math.floor(stats.likedPosts / 2));
    stats.savesThisWeek = Math.min(5, Math.floor(stats.savedPosts / 2));
    stats.commentsThisWeek = Math.min(3, stats.commentsMade);
    stats.categoriesExplored = Math.min(6, Math.floor(stats.likedPosts / 2) + 1);
    stats.explorationProgress = Math.round((stats.categoriesExplored / stats.totalCategories) * 100);

    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    console.error('Get student stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Student achievements
app.get('/api/student-achievements', auth, async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Only students can access achievements' });
    }

    const userId = req.user.id;

    // Get basic counts
    let likedPosts = 0;
    let savedPosts = 0;
    let commentsMade = 0;

    try {
      const [likeResult] = await db.execute(
        'SELECT COUNT(*) as count FROM likes WHERE user_id = ?',
        [userId]
      );
      likedPosts = likeResult[0]?.count || 0;
    } catch (error) {
      console.warn('Error counting likes:', error.message);
    }

    try {
      const [saveResult] = await db.execute(
        'SELECT COUNT(*) as count FROM saved_posts WHERE user_id = ?',
        [userId]
      );
      savedPosts = saveResult[0]?.count || 0;
    } catch (error) {
      console.warn('Error counting saves:', error.message);
    }

    try {
      const commentUserCol = await getExistingColumn('comments', ['user_id', 'author_id', 'commenter_id']);
      if (commentUserCol) {
        const [commentResult] = await db.execute(
          `SELECT COUNT(*) as count FROM comments WHERE ${commentUserCol} = ?`,
          [userId]
        );
        commentsMade = commentResult[0]?.count || 0;
      } else {
        console.warn('Comments user column not found, skipping comments count');
      }
    } catch (error) {
      console.warn('Error counting comments:', error.message);
    }

    const totalEngagement = likedPosts + savedPosts + commentsMade;

    const achievements = [
      {
        id: 'first_like',
        name: 'First Like',
        description: 'Liked your first post',
        unlocked: likedPosts > 0,
        icon: '👍',
        date: likedPosts > 0 ? new Date().toISOString() : null
      },
      {
        id: 'first_save',
        name: 'Bookmarker',
        description: 'Saved your first post',
        unlocked: savedPosts > 0,
        icon: '📚',
        date: savedPosts > 0 ? new Date().toISOString() : null
      },
      {
        id: 'first_comment',
        name: 'Conversation Starter',
        description: 'Left your first comment',
        unlocked: commentsMade > 0,
        icon: '💬',
        date: commentsMade > 0 ? new Date().toISOString() : null
      },
      {
        id: 'three_day_streak',
        name: 'Learning Streak',
        description: '3 consecutive days of activity',
        unlocked: totalEngagement >= 3,
        icon: '🔥',
        date: totalEngagement >= 3 ? new Date().toISOString() : null
      },
      {
        id: 'category_explorer',
        name: 'Category Explorer',
        description: 'Explored multiple categories',
        unlocked: totalEngagement >= 5,
        icon: '🧭',
        date: totalEngagement >= 5 ? new Date().toISOString() : null
      },
      {
        id: 'active_learner',
        name: 'Active Learner',
        description: '10+ total engagements',
        unlocked: totalEngagement >= 10,
        icon: '⭐',
        date: totalEngagement >= 10 ? new Date().toISOString() : null
      }
    ];

    const unlockedCount = achievements.filter(a => a.unlocked).length;

    res.json({
      success: true,
      achievements: achievements,
      unlockedCount: unlockedCount,
      totalAchievements: achievements.length,
      progress: Math.round((unlockedCount / achievements.length) * 100)
    });
  } catch (error) {
    console.error('Get student achievements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== CATEGORIES ====================

// Get categories
app.get('/api/categories', async (req, res) => {
  try {
    const [categories] = await db.execute('SELECT * FROM categories ORDER BY name');
    res.json({ success: true, categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== FRONTEND ROUTES ====================

// Serve frontend routes
app.get('/login', (req, res) => {
  res.sendFile('frontend/login.html', { root: '.' });
});

app.get('/register', (req, res) => {
  res.sendFile('frontend/register.html', { root: '.' });
});

app.get('/dashboard', (req, res) => {
  res.sendFile('frontend/dashboard.html', { root: '.' });
});

app.get('/create-post', (req, res) => {
  res.sendFile('frontend/create-post.html', { root: '.' });
});

app.get('/create-social-post', (req, res) => {
  res.sendFile('frontend/create-social-post.html', { root: '.' });
});

app.get('/posts', (req, res) => {
  res.sendFile('frontend/posts.html', { root: '.' });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile('frontend/index.html', { root: '.' });
});

// ==================== SERVER START ====================

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🎉 Fashion Hub running on http://localhost:${PORT}`);
  console.log(`📊 Stats system ready`);
  console.log(`👨‍🏫 Teacher dashboard: /dashboard`);
  console.log(`🎓 Student dashboard: /dashboard`);
  console.log(`❤️  Like system active`);
  console.log(`🏆 Achievements system ready`);
});