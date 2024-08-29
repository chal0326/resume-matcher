const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const expressLayouts = require('express-ejs-layouts');
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', './views');
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: 'smtp.example.com',
  port: 587,
  auth: {
    user: 'your-email@example.com',
    pass: 'your-password'
  }
});
const db = new sqlite3.Database('resume_matcher.db');

function sendNotification(user, jobPosting) {
  const mailOptions = {
    from: 'noreply@resumematcher.com',
    to: user.email,
    subject: 'New Matching Job Posting',
    text: `A new job posting matches your skills: ${jobPosting.title} at ${jobPosting.company}`
  };
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log('Email sent: ' + info.response);
    }
  });
}
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

app.post('/job-postings', (req, res) => {
  const { title, company, description, required_skills } = req.body;
  db.run("INSERT INTO job_postings (title, company, description, required_skills) VALUES (?, ?, ?, ?)",
    [title, company, description, required_skills],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      const jobId = this.lastID;
      db.all("SELECT u.* FROM users u JOIN skills s ON u.id = s.user_id WHERE s.name IN (" + 
        required_skills.split(',').map(() => '?').join(',') + ")",
        required_skills.split(','),
        (err, matchingUsers) => {
          if (err) return console.error(err.message);
          matchingUsers.forEach(user => sendNotification(user, { id: jobId, title, company }));
        }
      );
      res.redirect('/job-postings');
    }
  );
});

// JWT secret key
//const JWT_SECRET = 'your-secret-key'; // In production, use an environment variable

// Middleware to verify JWT
//function authenticateToken(req, res, next) {
//  const token = req.cookies.token;
//  if (token == null) return res.sendStatus(401);

//  jwt.verify(token, JWT_SECRET, (err, user) => {
//    if (err) return res.sendStatus(403);
//    req.user = user;
//    next();
//  });
//}
function calculateSkillMatch(jobSkills, userSkills) {
  const jobSkillSet = new Set(jobSkills.map(s => s.toLowerCase()));
  const userSkillSet = new Set(userSkills.map(s => s.toLowerCase()));
  const matchedSkills = new Set([...jobSkillSet].filter(x => userSkillSet.has(x)));
  return {
    matchedSkills: Array.from(matchedSkills),
    matchPercentage: (matchedSkills.size / jobSkillSet.size) * 100
  };
}
function generateResumeContent(jobPosting, workHistoryEntries) {
  let content = `Resume for ${jobPosting.title} at ${jobPosting.company}\n\n`;
  content += `Work Experience:\n`;
  
  // Group entries by company and position
  const groupedEntries = workHistoryEntries.reduce((acc, entry) => {
    const key = `${entry.company}-${entry.position}`;
    if (!acc[key]) {
      acc[key] = {
        company: entry.company,
        position: entry.position,
        start_date: entry.start_date,
        end_date: entry.end_date,
        entries: []
      };
    }
    acc[key].entries.push({
      description: entry.description,
      skills: entry.skills
    });
    return acc;
  }, {});

  Object.values(groupedEntries).forEach(job => {
    content += `${job.position} at ${job.company}\n`;
    content += `${job.start_date} - ${job.end_date}\n`;
    job.entries.forEach(entry => {
      content += `- ${entry.description}\n`;
      content += `  Skills: ${entry.skills}\n`;
    });
    content += '\n';
  });

  return content;
}
app.get('/', (req, res) => {
  res.render('index');
});

// Registration route
app.post('/register', async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    db.run("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", 
      [req.body.name, req.body.email, hashedPassword], 
      (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.status(201).send('User created');
      });
  } catch {
    res.status(500).send();
  }
});

// Login route
app.post('/login', (req, res) => {
  db.get("SELECT * FROM users WHERE email = ?", [req.body.email], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!user) {
      return res.status(400).send('Cannot find user');
    }
    try {
      if (await bcrypt.compare(req.body.password, user.password)) {
        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token, { httpOnly: true });
        res.send('Login successful');
      } else {
        res.send('Not Allowed');
      }
    } catch {
      res.status(500).send();
    }
  });
});

// Logout route
app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.send('Logged out');
});

// Protect routes that require authentication
app.get('/add-work-history', (req, res) => {
  res.render('add-work-history');
});

app.post('/add-work-history', (req, res) => {
  const { company, position, start_date, end_date, descriptions, skills } = req.body;
  
  // For demonstration, we'll use a placeholder user_id
  const user_id = 1; // In a real app, this would come from the authenticated user's session

  // First, insert the main work history entry
  db.run("INSERT INTO work_history (user_id, company, position, start_date, end_date) VALUES (?, ?, ?, ?, ?)",
    [user_id, company, position, start_date, end_date],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      const work_history_id = this.lastID;
      
      // Now, insert each description and its associated skills
      const entryInsertPromises = descriptions.map((description, index) => {
        return new Promise((resolve, reject) => {
          db.run("INSERT INTO work_history_entries (work_history_id, description, skills) VALUES (?, ?, ?)",
            [work_history_id, description, skills[index]],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      });
      
      Promise.all(entryInsertPromises)
        .then(() => {
          res.redirect('/');
        })
        .catch((err) => {
          res.status(500).json({ error: err.message });
        });
    }
  );
});

app.post('/generate-resume', (req, res) => {
  const { jobPostingId, selectedEntries } = req.body;
  db.get("SELECT * FROM job_postings WHERE id = ?", [jobPostingId], (err, jobPosting) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all(`
      SELECT wh.*, whe.description, whe.skills
      FROM work_history wh
      JOIN work_history_entries whe ON wh.id = whe.work_history_id
      WHERE wh.id IN (${selectedEntries.join(',')})
    `, [], (err, workHistoryEntries) => {
      if (err) return res.status(500).json({ error: err.message });
      
      const resumeContent = generateResumeContent(jobPosting, workHistoryEntries);
      res.render('custom-resume', { resumeContent });
    });
  });
});
app.get('/manage-skills', (req, res) => {
  db.all("SELECT * FROM skills WHERE user_id = ?", [req.user.id], (err, skills) => {
    if (err) return res.status(500).json({ error: err.message });
    res.render('manage-skills', { skills });
  });
});

app.post('/add-skill', (req, res) => {
  const { skillName } = req.body;
  db.run("INSERT INTO skills (user_id, name) VALUES (?, ?)", [req.user.id, skillName], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.redirect('/manage-skills');
  });
});

app.get('/match-resume/:id', (req, res) => {
  const jobId = req.params.id;
  db.get("SELECT * FROM job_postings WHERE id = ?", [jobId], (err, jobPosting) => {
    if (err) return res.status(500).json({ error: err.message });
    db.all(`
      SELECT wh.*, whe.description, whe.skills
      FROM work_history wh
      JOIN work_history_entries whe ON wh.id = whe.work_history_id
      WHERE wh.user_id = ?
    `, [req.user.id], (err, workHistoryEntries) => {
      if (err) return res.status(500).json({ error: err.message });
 
      const jobSkills = jobPosting.required_skills.split(',').map(s => s.trim());
      const matchedEntries = workHistoryEntries.map(entry => {
        const entrySkills = entry.skills.split(',').map(s => s.trim());
        const match = calculateSkillMatch(jobSkills, entrySkills);
        return { ...entry, ...match };
      });
      
      res.render('match-resume', { jobPosting, workHistoryEntries: matchedEntries });
    });
  });
});
app.get('/dashboard', (req, res) => {
  db.all("SELECT * FROM work_history WHERE user_id = ?", [req.user.id], (err, workHistory) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const skillCounts = workHistory.reduce((acc, entry) => {
      entry.skills.split(',').forEach(skill => {
        acc[skill.trim()] = (acc[skill.trim()] || 0) + 1;
      });
      return acc;
    }, {});
    
    res.render('dashboard', { skillCounts });
  });
});
app.post('/apply-job', (req, res) => {
  const { jobId } = req.body;
  db.run("INSERT INTO applications (user_id, job_id, status) VALUES (?, ?, ?)", 
    [req.user.id, jobId, 'applied'], 
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.redirect('/job-postings');
    });
});

app.get('/applications', (req, res) => {
  db.all("SELECT a.*, j.title, j.company FROM applications a JOIN job_postings j ON a.job_id = j.id WHERE a.user_id = ?", 
    [req.user.id], 
    (err, applications) => {
      if (err) return res.status(500).json({ error: err.message });
      res.render('applications', { applications });
    });
});

app.get('/import-linkedin', async (req, res) => {
  try {
    const response = await axios.get('https://api.linkedin.com/v2/me', {
      headers: { 'Authorization': `Bearer ${req.user.linkedinToken}` }
    });
    const profile = response.data;
    db.run("UPDATE users SET linkedin_data = ? WHERE id = ?", 
      [JSON.stringify(profile), req.user.id], 
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.redirect('/dashboard');
      });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    linkedin_data TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS job_postings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    company TEXT,
    description TEXT,
    required_skills TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    job_id INTEGER,
    status TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (job_id) REFERENCES job_postings(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS work_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    company TEXT,
    position TEXT,
    start_date TEXT,
    end_date TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS work_history_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_history_id INTEGER,
    description TEXT,
    skills TEXT,
    FOREIGN KEY (work_history_id) REFERENCES work_history(id)
  )`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));