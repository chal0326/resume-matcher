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

const JWT_SECRET = process.env.JWT_SECRET;

// Middleware to check JWT
function authenticateToken(req, res, next) {
  const token = req.cookies.token;
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) return res.sendStatus(403);
    try {
      // Use the Supabase client to get the user
      const { data: { user: supabaseUser }, error } = await supabase.auth.getUser(token);
      
      if (error) throw error;
      req.user = supabaseUser;
      next();
    } catch (error) {
      console.error('Error fetching user:', error);
      res.sendStatus(500);
    }
  });
}

// Add this new route for the home page
app.get('/', (req, res) => {
  res.render('home', { title: 'Home' });
});

app.get('/register', (req, res) => {
  res.render('register', { title: 'Register' });
});

app.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // First, create the user
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          name: name,
        }
      }
    });

    if (signUpError) throw signUpError;

    console.log('User registered successfully:', signUpData);

    // Now, invite the user (this will automatically confirm their email)
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email);

    if (inviteError) {
      console.error('Error inviting user:', inviteError);
      throw inviteError;
    }

    console.log('User invited and email confirmed:', inviteData);

    res.redirect('/login');
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Login' });
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) throw error;

    const token = data.session.access_token;
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).send('Invalid credentials');
  }
});

app.get('/dashboard', authenticateToken, (req, res) => {
  res.render('dashboard', { user: req.user });
});

// Add this route to render the add-work-history page
app.get('/add-work-history', authenticateToken, (req, res) => {
  res.render('add-work-history', { title: 'Add Work History' });
});

// Add this route to handle the form submission
app.post('/add-work-history', authenticateToken, async (req, res) => {
  try {
    const { company, position, start_date, end_date, descriptions, skills } = req.body;
    const userId = req.user.id; // This should now be the correct UUID

    console.log('User ID:', userId); // Add this line for debugging

    // Insert the work history into the database
    const { data, error } = await supabase
      .from('work_history')
      .insert({
        user_id: userId,
        company,
        position,
        start_date,
        end_date: end_date || null,
      })
      .select();

    if (error) {
      console.error('Error inserting work history:', error);
      throw error;
    }

    console.log('Inserted work history:', data); // Add this line for debugging

    // Insert the descriptions and skills
    const workHistoryId = data[0].id;
    const entries = Array.isArray(descriptions) ? descriptions.map((description, index) => ({
      work_history_id: workHistoryId,
      description,
      skills: Array.isArray(skills) ? skills[index] : skills,
    })) : [{
      work_history_id: workHistoryId,
      description: descriptions,
      skills: skills,
    }];

    const { error: entriesError } = await supabase
      .from('work_history_entries')
      .insert(entries);

    if (entriesError) throw entriesError;

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error adding work history:', error);
    res.status(500).json({ error: 'Failed to add work history', details: error.message });
  }
});

// Add this catch-all route at the end of your routes
app.use((req, res) => {
  res.status(404).render('404');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));