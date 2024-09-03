import dotenv from 'dotenv/config';
import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import { createClient } from '@supabase/supabase-js';
import cookieParser from 'cookie-parser';
import axios from 'axios';
import cors from 'cors';
import OpenAI from "openai";

const app = express();
// Supabase setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// EJS setup
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('layout', 'layout');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Middleware to check authentication
async function authenticateUser(req, res, next) {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (session) {
    req.user = session.user;
  } else {
    req.user = null;
  }
  
  next();
}
app.use(cors());
app.use(express.json());
app.use(authenticateUser);

app.use((req, res, next) => {
  res.locals.user = req.user;
  res.locals.title = 'Resume Matcher';
  next();
});
const port = process.env.PORT || 3000;
// Routes
app.get('/', (req, res) => {
  res.render('home', { title: 'Home' });
});

app.get('/register', (req, res) => {
  res.render('register', { title: 'Register' });
});

app.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } }
  });

  if (error) {
    res.status(500).render('register', { title: 'Register', error: error.message });
  } else {
    res.redirect('/login');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Login' });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    res.status(400).render('login', { title: 'Login', error: 'Invalid credentials' });
  } else {
    res.redirect('/dashboard');
  }
});

app.get('/dashboard', async (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }

  try {
    const { data: workHistory, error } = await supabase
      .from('work_history')
      .select(`
        id,
        company,
        position,
        start_date,
        end_date,
        work_history_entries (
          id,
          description,
          skills
        )
      `)
      .eq('user_id', req.user.id)
      .order('start_date', { ascending: false });

    if (error) throw error;

    res.render('dashboard', { 
      title: 'Dashboard',
      workHistory,
      user: req.user
    });
  } catch (error) {
    console.error('Error in dashboard route:', error);
    res.status(500).render('dashboard', { 
      title: 'Dashboard',
      workHistory: [],
      error: 'Failed to fetch work history: ' + error.message,
      user: req.user
    });
  }
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

app.get('/logout', async (req, res) => {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Error during sign out:', error);
  res.redirect('/login');
});
app.get('/add-job-listing', authenticateUser, (req, res) => 
  { res.render('add-job-listing', { title: 'Add Job Listing' });});
// Get a single work history entry
app.get('/work-history-entry/:id', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('work_history_entries')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

    res.render('partials/work-history-entry', { entry: data });
  } catch (error) {
    console.error('Error fetching work history entry:', error);
    res.status(500).send('Failed to fetch work history entry');
  }
});

// Update a work history entry
app.put('/work-history-entry/:id', authenticateUser, async (req, res) => {
  try {
    const { description, skills } = req.body;
    const { data, error } = await supabase
      .from ('work_history_entries')
      .update({ description, skills: skills.split(',').map(s => s.trim()) })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.render('partials/work-history-entry', { entry: data });
  } catch (error) {
    console.error('Error updating work history entry:', error);
    res.status(500).send('Failed to update work history entry');
  }
});

// Delete a work history entry
app.delete('/work-history-entry/:id', authenticateUser, async (req, res) => {
  try {
    const { error } = await supabase
      .from('work_history_entries')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    res.sendStatus(200);
  } catch (error) {
    console.error('Error deleting work history entry:', error);
    res.status(500).send('Failed to delete work history entry');
  }
});

// Add a new work history entry
app.post('/work-history-entry', authenticateUser, async (req, res) => {
  try {
    const { description, skills, jobId } = req.body;
    const { data, error } = await supabase
      .from('work_history_entries')
      .insert({
        work_history_id: jobId,
        description,
        skills: skills.split(',').map(s => s.trim())
      })
      .select()
      .single();

    if (error) throw error;

    res.render('partials/work-history-entry', { entry: data });
  } catch (error) {
    console.error('Error adding work history entry:', error);
    res.status(500).send('Failed to add work history entry');
  }
});

const token = process.env.GITHUB_TOKEN;
const endpoint = process.env.MODEL_ENDPOINT;
const modelName = process.env.MODEL_NAME;

console.log('Model Endpoint:', endpoint); // Add this for debugging
console.log('Model Name:', modelName); // Add this for debugging

app.post('/match-resume', authenticateUser, async (req, res) => {
  try {
    const { jobListingId } = req.body;
    const { user } = req;

    // Fetch job listing
    const { data: jobListing, error: jobError } = await supabase
      .from('job_listings')
      .select('*')
      .eq('id', jobListingId)
      .single();

    if (jobError) throw new Error(`Failed to fetch job listing: ${jobError.message}`);

    // Fetch user's work history
    const { data: workHistory, error: workHistoryError } = await supabase
      .from('work_history')
      .select(`
        id,
        company,
        position,
        start_date,
        end_date,
        work_history_entries (
          id,
          description,
          skills
        )
      `)
      .eq('user_id', user.id);

    if (workHistoryError) throw new Error(`Failed to fetch work history: ${workHistoryError.message}`);

    const client = new OpenAI({ baseURL: endpoint, apiKey: token });

    const response = await client.chat.completions.create({
      messages: [
        { role: "system", content: "You are an AI assistant that analyzes work history and job descriptions to determine how well they match." },
        { role: "user", content: `Analyze this work history and job description. Provide a percentage match and a brief explanation of the strengths and weaknesses of the match. Work History: ${JSON.stringify(workHistory)} Job Description: ${JSON.stringify(jobListing)}` }
      ],
      model: modelName,
      temperature: 0.7,
      max_tokens: 1000,
      top_p: 1
    });

    let aiAnalysis = response.choices[0].message.content;

    res.json({ aiAnalysis });
  } catch (error) {
    console.error('Error matching resume:', error);
    res.status(500).json({ error: 'Failed to match resume: ' + error.message });
  }
});

app.get('/match-resume', authenticateUser, async (req, res) => {
  try {
    const { data: jobListings, error } = await supabase
      .from('job_listings')
      .select('id, title, company');

    if (error) throw error;

    res.render('match-resume', { jobListings });
  } catch (error) {
    console.error('Error fetching job listings:', error);
    res.status(500).render('error', { message: 'Failed to load job listings' });
  }
});

app.get('/', (req, res) => {
  res.send('AI Resume Tool API is running!');
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;
