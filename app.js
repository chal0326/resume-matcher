require('dotenv').config();
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();

// Supabase setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// EJS setup
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('layout', 'layout'); // This tells express to use layout.ejs as the default layout

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Add this function before you use it in any routes
async function authenticateUser(req, res, next) {
  const token = req.cookies['supabase-auth-token'];
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    // First, try to get the user with the existing token
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error && error.message.includes('token is expired')) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({ refresh_token: token });
      if (refreshError) {
        res.clearCookie('supabase-auth-token');
        req.user = null;
      } else {
        res.cookie('supabase-auth-token', refreshData.session.access_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 60 * 60 * 24 * 7 * 1000 // 1 week
        });
        req.user = refreshData.user;
      }
    } else if (error) {
      res.clearCookie('supabase-auth-token');
      req.user = null;
    } else {
      req.user = user;
    }
  } catch (error) {
    console.error('Authentication error:', error);
    res.clearCookie('supabase-auth-token');
    req.user = null;
  }
  next();
}

app.use(authenticateUser);

// Add this after your other middleware setup
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.title = 'Resume Matcher';
  next();
});

// Add this new route for the home page
app.get('/', (req, res) => {
  res.locals.title = 'Home'; 
  res.render('home', { title: 'Home', user: req.user });
});

app.get('/register', (req, res) => {
  res.locals.title = 'Register';
  res.render('register', { title: 'Register', user: req.user });
});

app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { name: name }
      }
    });

    if (error) throw error;

    console.log('User registered successfully:', data);
    res.redirect('/login');
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

app.get('/login', (req, res) => {
  res.locals.title = 'Login';
  res.render('login', { title: 'Login', user: req.user });
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) throw error;

    // Set both access token and refresh token in cookies
    res.cookie('supabase-auth-token', data.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7 * 1000 // 1 week
    });
    res.cookie('supabase-refresh-token', data.session.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30 * 1000 // 30 days
    });

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).render('login', { title: 'Login', error: 'Invalid credentials', user: null });
  }
});

app.get('/dashboard', (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }
  res.locals.title = 'Dashboard';
  res.render('dashboard', { title: 'Dashboard', user: req.user });
});

// Add this route to render the add-work-history page
app.get('/add-work-history', authenticateUser, (req, res) => {
  res.render('add-work-history', { title: 'Add Work History' });
});

// Add this route to handle the form submission
app.post('/add-work-history', authenticateUser, async (req, res) => {
  try {
    const { company, position, start_date, end_date, descriptions, skills } = req.body;
    const userId = req.user.id;
    console.log('User ID:', userId); // Add this for debugging
    // Validate skills input
    const validateSkills = (skillsString) => {
      const skillsArray = skillsString.split(',').map(skill => skill.trim()).filter(skill => skill !== '');
      if (skillsArray.length === 0) {
        throw new Error('Skills must be a comma-separated list of non-empty values');
      }
      return skillsArray;
    };

    // Insert the work history into the database
    const { data: workHistoryData, error: workHistoryError } = await supabase
      .from('work_history')
      .insert({
        user_id: userId,
        company,
        position,
        start_date,
        end_date: end_date || null,
      })
      .select();

      if (workHistoryError) {
        console.error('Work history insert error:', workHistoryError);
        throw workHistoryError;
      }
      console.log('Inserted work history:', workHistoryData); // Add this for debugging
    const workHistoryId = workHistoryData[0].id;

    // Process and insert entries
    const entries = Array.isArray(descriptions) ? descriptions.map((description, index) => ({
      work_history_id: workHistoryId,
      description,
      skills: validateSkills(Array.isArray(skills) ? skills[index] : skills),
    })) : [{
      work_history_id: workHistoryId,
      description: descriptions,
      skills: validateSkills(skills),
    }];

    const { error: entriesError } = await supabase
      .from('work_history_entries')
      .insert(entries);

    if (entriesError) throw entriesError;

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error adding work history:', error);
    res.status(500).render('add-work-history', { 
      title: 'Add Work History',
      error: 'Failed to add work history: ' + error.message
    });
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('supabase-auth-token');
  res.redirect('/');
});
// Add this catch-all route at the end of your routes
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
  res.status(404).render('404');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Add logout route
app.get('/logout', (req, res) => {
  res.clearCookie('supabase-auth-token');
  res.redirect('/login');
});