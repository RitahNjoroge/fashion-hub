// Client-side logic for posts page: auth, loading, rendering and search
let __posts = [];

function checkAuth() {
  try {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    const authButtons = document.getElementById('auth-buttons');
    const userMenu = document.getElementById('user-menu');
    const createPostBtn = document.getElementById('create-post-btn');

    if (token && user) {
      authButtons?.classList.add('hidden');
      userMenu?.classList.remove('hidden');
      const userData = JSON.parse(user);
      if (userData.role === 'teacher') {
        createPostBtn?.classList.remove('hidden');
      }
    } else {
      authButtons?.classList.remove('hidden');
      userMenu?.classList.add('hidden');
      createPostBtn?.classList.add('hidden');
    }
  } catch (e) {
    console.warn('Auth check failed', e);
  }
}

async function loadPosts() {
  const container = document.getElementById('posts-list');
  if (!container) return;
  
  container.innerHTML = '<div class="loading">Loading posts…</div>';

  try {
    const res = await fetch('/api/posts');
    if (!res.ok) throw new Error('Network response not ok');
    const data = await res.json();
    __posts = data.posts || [];
    
    // Enhance posts with like status if user is logged in
    const token = localStorage.getItem('token');
    if (token) {
      for (let post of __posts) {
        try {
          const likeResponse = await fetch(`/api/posts/${post.id}/like-status`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (likeResponse.ok) {
            const likeData = await likeResponse.json();
            post.user_liked = likeData.liked;
            post.like_count = likeData.likeCount;
          }
        } catch (error) {
          console.warn('Could not fetch like status for post:', post.id);
        }
      }
    }
    
    renderPosts(__posts);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="error">Error loading posts. Please try again later.</div>';
  }
}

function renderPosts(posts) {
  const container = document.getElementById('posts-list');
  if (!container) return;
  container.innerHTML = '';

  if (!posts.length) {
    container.innerHTML = '<div class="empty-state">No posts found.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  posts.forEach(post => {
    const card = createPostCard(post);
    frag.appendChild(card);
  });

  container.appendChild(frag);
}

function createPostCard(post) {
  const card = document.createElement('article');
  card.className = 'post-card';
  card.setAttribute('data-post-id', post.id);
  
  // Image
  if (post.image_url) {
    const imgContainer = document.createElement('div');
    imgContainer.className = 'post-image-container';
    const img = document.createElement('img');
    img.src = post.image_url;
    img.alt = post.title || 'Post image';
    img.loading = 'lazy';
    img.className = 'post-image';
    imgContainer.appendChild(img);
    card.appendChild(imgContainer);
  }

  // Meta info
  const meta = document.createElement('div');
  meta.className = 'post-meta';
  meta.innerHTML = `
    <span class="post-category">${post.category_name || 'General'}</span>
    <span>• By ${post.author_name || 'Anonymous'} • ${new Date(post.created_at).toLocaleDateString()}</span>
  `;
  card.appendChild(meta);

  // Title
  const title = document.createElement('h3');
  title.textContent = post.title || 'Untitled';
  card.appendChild(title);

  // Content
  const content = document.createElement('p');
  content.textContent = post.content || '';
  card.appendChild(content);

  // Interactions
  const interactions = document.createElement('div');
  interactions.className = 'post-interactions';
  interactions.innerHTML = `
    <button class="like-btn ${post.user_liked ? 'liked' : ''}" 
            onclick="toggleLike(${post.id})"
            data-post-id="${post.id}">
        <span class="like-icon">${post.user_liked ? '❤️' : '🤍'}</span>
        <span class="like-count">${post.like_count || 0}</span>
    </button>
    <span class="view-count">👁️ ${post.view_count || 0}</span>
    <button class="save-btn" onclick="toggleSave(${post.id})" title="Save post">
        📖
    </button>
  `;
  card.appendChild(interactions);

  return card;
}

// Like functionality
async function toggleLike(postId) {
  try {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please log in to like posts');
      return;
    }

    const response = await fetch(`/api/posts/${postId}/like`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      
      // Update the like button UI
      const likeBtn = document.querySelector(`.like-btn[data-post-id="${postId}"]`);
      const likeIcon = likeBtn?.querySelector('.like-icon');
      const likeCount = likeBtn?.querySelector('.like-count');
      
      if (likeBtn && likeIcon && likeCount) {
        if (data.liked) {
          likeBtn.classList.add('liked');
          likeIcon.textContent = '❤️';
          likeCount.textContent = parseInt(likeCount.textContent) + 1;
          likeBtn.classList.add('pulse');
          setTimeout(() => likeBtn.classList.remove('pulse'), 500);
        } else {
          likeBtn.classList.remove('liked');
          likeIcon.textContent = '🤍';
          likeCount.textContent = parseInt(likeCount.textContent) - 1;
        }
      }
      
    } else {
      throw new Error('Failed to toggle like');
    }
  } catch (error) {
    console.error('Toggle like error:', error);
    alert('Error liking post');
  }
}

// Save functionality
async function toggleSave(postId) {
  try {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please log in to save posts');
      return;
    }

    const response = await fetch(`/api/posts/${postId}/save`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      const saveBtn = document.querySelector(`.save-btn[onclick="toggleSave(${postId})"]`);
      if (saveBtn) {
        saveBtn.textContent = data.saved ? '📚' : '📖';
        saveBtn.classList.add('pulse');
        setTimeout(() => saveBtn.classList.remove('pulse'), 500);
      }
    } else {
      throw new Error('Failed to toggle save');
    }
  } catch (error) {
    console.error('Toggle save error:', error);
    alert('Error saving post');
  }
}

// Track post views
async function trackView(postId) {
  try {
    await fetch(`/api/posts/${postId}/view`, {
      method: 'POST'
    });
  } catch (error) {
    console.error('Track view error:', error);
  }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
}

function setupSearch() {
  const input = document.getElementById('post-search');
  if (!input) return;

  input.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return renderPosts(__posts);
    
    const filtered = __posts.filter(p => {
      return (p.title || '').toLowerCase().includes(q) ||
             (p.content || '').toLowerCase().includes(q) ||
             (p.author_name || '').toLowerCase().includes(q) ||
             (p.category_name || '').toLowerCase().includes(q);
    });
    renderPosts(filtered);
  });
}

// Navigation
function navigateTo(url) {
  window.location.href = url;
}

// Initialize everything when page loads
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  loadPosts();
  setupSearch();
  
  // Load preview posts if needed
  const previewEl = document.getElementById('posts-preview');
  if (previewEl) loadPreviewPosts('posts-preview', 3);
  
  const recEl = document.getElementById('recommended-posts');
  if (recEl) loadPreviewPosts('recommended-posts', 3);
  
  // Global functions
  window.logout = logout;
  window.navigateTo = navigateTo;
  window.toggleLike = toggleLike;
  window.toggleSave = toggleSave;
  window.trackView = trackView;
  
  setupNavToggle();
  setupNavigationHandlers();
});

function setupNavigationHandlers() {
  // Dashboard links
  const dashboardLinks = document.querySelectorAll('a[href*="dashboard"]');
  dashboardLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const token = localStorage.getItem('token');
      window.location.href = token ? '/dashboard' : '/login';
    });
  });

  // Create post links
  const createPostLinks = document.querySelectorAll('a[href*="create-post"]');
  createPostLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const token = localStorage.getItem('token');
      const user = localStorage.getItem('user');
      
      if (token && user) {
        const userData = JSON.parse(user);
        if (userData.role === 'teacher') {
          window.location.href = '/create-post';
        } else {
          alert('Only teachers can create posts');
          window.location.href = '/dashboard';
        }
      } else {
        window.location.href = '/login';
      }
    });
  });
}

async function loadPreviewPosts(containerId, limit = 3) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = '<div class="loading">Loading posts…</div>';

  try {
    const res = await fetch('/api/posts');
    if (!res.ok) throw new Error('Network response not ok');
    
    const data = await res.json();
    const posts = (data.posts || []).slice(0, limit);

    if (!posts.length) {
      container.innerHTML = '<div class="empty-state">No posts available yet.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    posts.forEach(post => {
      const card = createPostCard(post);
      frag.appendChild(card);
    });

    container.innerHTML = '';
    container.appendChild(frag);
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="error">Error loading posts.</div>';
  }
}

// Navigation toggle
function setupNavToggle() {
  const toggle = document.getElementById('nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (!toggle || !navLinks) return;

  toggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!navLinks.classList.contains('open')) return;
    if (e.target === toggle) return;
    if (!navLinks.contains(e.target) && !toggle.contains(e.target)) {
      navLinks.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Close on resize
  window.addEventListener('resize', () => {
    if (window.innerWidth > 800) {
      navLinks.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}