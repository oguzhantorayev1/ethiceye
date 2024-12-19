const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { google } = require("googleapis");
const cors = require("cors");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Apply CORS middleware
app.use(cors());

// Serve static files from the main directory
app.use(express.static(__dirname));

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
  keyFile: "keys.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// Create a promise to get the authenticated client
const authClientPromise = auth.getClient();

// Initialize the Google Sheets API without the auth client
const sheets = google.sheets({ version: "v4" });

// Mapping of regions to their respective spreadsheet IDs
const REGION_SPREADSHEET_IDS = {
  USC: "1ZftEL6ldp_Tni1EkHu2A7ivGXU8Qmd74F8b6VtSxayM",
  APAC: "1WQ0Eec63ZZgVcN-wpcOEjo0xKkCY6Vw2PyqPnQllnTs",
  PORT: "1qHUzy7tMdXNUA69wJHPIpsmX7rZObgSGuxUKgpJ3oR4",
  EMEA: "1-ccvD_pz1BubgQNCFHodaGRIpGLfeGlm8MjOHZpyJW4",
  LATAM: "1mJoHwo6FvT-ylcZZBAkpbTwS7PTX8_FiGfO-ob6P_i4",
};

// Define ranges for different sheets within the spreadsheets
const TEAM_DATA_RANGE = "TeamData!A:B"; // Team Data sheet
const CIPHER_RANGE = "Cipher Pieces!A:C"; // Cipher Pieces sheet
const SERVER_QUESTION_RANGE = "Cipher Pieces!A15:E17"; // Specific range within Cipher Pieces sheet
const QUIZ_RANGE = "GlobeGame!A:J"; // QuizData sheet

// Helper function to get the spreadsheet ID for a given region
function getSpreadsheetId(region) {
  const spreadsheetId = REGION_SPREADSHEET_IDS[region];
  if (!spreadsheetId) {
    throw new Error(`Invalid region: ${region}`);
  }
  return spreadsheetId;
}

// Fetch data from Google Sheets
async function fetchDataFromSheet(spreadsheetId, range) {
  const authClient = await authClientPromise;
  const response = await sheets.spreadsheets.values.get({
    auth: authClient,
    spreadsheetId,
    range,
  });
  return response.data.values || [];
}

// Get team data
async function getTeamData(region) {
  try {
    const spreadsheetId = getSpreadsheetId(region);
    const rows = await fetchDataFromSheet(spreadsheetId, TEAM_DATA_RANGE);
    return rows;
  } catch (error) {
    console.error(`Error fetching team data for region ${region}:`, error);
    return [];
  }
}

// Get cipher data
async function getCipherData(region) {
  try {
    const spreadsheetId = getSpreadsheetId(region);
    const rows = await fetchDataFromSheet(spreadsheetId, CIPHER_RANGE);
    const dataRows = rows.slice(1); // Skip the header row
    return dataRows.map((row, index) => ({
      cipher: row[0] || "",
      cipherA: row[1] || "",
      cipherB: row[2] || "",
      rowIndex: index + 1,
    }));
  } catch (error) {
    console.error(`Error fetching cipher data for region ${region}:`, error);
    return [];
  }
}

// Get server question data
async function getServerQuestionData(region) {
  try {
    const spreadsheetId = getSpreadsheetId(region);
    const rows = await fetchDataFromSheet(spreadsheetId, SERVER_QUESTION_RANGE);
    const [headers, questionRow, feedbackRow] = rows;

    return {
      ServerQuestion: questionRow[0] || "",
      ServerChoiceA: questionRow[1] || "",
      ServerChoiceB: questionRow[2] || "",
      ServerChoiceC: questionRow[3] || "",
      ServerChoiceD: questionRow[4] || "",
      FeedbackA: feedbackRow[1] || "",
      FeedbackB: feedbackRow[2] || "",
      FeedbackC: feedbackRow[3] || "",
      FeedbackD: feedbackRow[4] || "",
    };
  } catch (error) {
    console.error(
      `Error fetching server question data for region ${region}:`,
      error,
    );
    return {};
  }
}

// Get quiz data
async function getQuizData(region) {
  try {
    const spreadsheetId = getSpreadsheetId(region);
    const rows = await fetchDataFromSheet(spreadsheetId, QUIZ_RANGE);
    const dataRows = rows.slice(1); // Skip the header row
    return dataRows.map((row) => {
      const country = row[0];
      const scenario = row[1];
      const newsflash = row[2];
      const source = row[3];
      const question = row[4];
      const correctAnswer = row[5];
      const incorrectAnswer1 = row[6];
      const incorrectAnswer2 = row[7];
      const lat = parseFloat(row[8]);
      const lon = parseFloat(row[9]);

      const choices = [correctAnswer, incorrectAnswer1, incorrectAnswer2].sort(
        () => Math.random() - 0.5,
      );
      const correctIndex = choices.indexOf(correctAnswer);

      return {
        country,
        scenario,
        newsflash,
        source,
        question,
        choices,
        correct: correctIndex,
        lat,
        lon,
      };
    });
  } catch (error) {
    console.error(`Error fetching quiz data for region ${region}:`, error);
    return [];
  }
}

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("fetchPlayerData", async (email, region) => {
    try {
      const teamData = await getTeamData(region);
      const playerInfo = teamData.find((row) => row[0] === email);
      if (playerInfo) {
        const [email, fullName] = playerInfo;
        socket.emit("playerData", { email, fullName });
      } else {
        socket.emit("error", "Player not found in team assignments");
      }
    } catch (error) {
      console.error(`Error in fetchPlayerData for region ${region}:`, error);
      socket.emit("error", "Error fetching player data");
    }
  });

  socket.on("fetchCipherData", async (region) => {
    try {
      const cipherData = await getCipherData(region);
      socket.emit("cipherData", cipherData);
    } catch (error) {
      console.error(`Error in fetchCipherData for region ${region}:`, error);
      socket.emit("error", "Error fetching cipher data");
    }
  });

  socket.on("fetchServerQuestionData", async (region) => {
    try {
      const data = await getServerQuestionData(region);
      socket.emit("serverQuestionData", data);
    } catch (error) {
      console.error(
        `Error in fetchServerQuestionData for region ${region}:`,
        error,
      );
      socket.emit("error", "Error fetching server question data");
    }
  });

  socket.on("fetchRosterData", async (region) => {
    try {
      const teamData = await getTeamData(region);
      const emails = teamData.map((row) => row[0]);
      const fullNames = teamData.map((row) => row[1]);
      const rosterCount = emails.length;
      socket.emit("rosterData", { emails, fullNames, rosterCount });
    } catch (error) {
      console.error(`Error in fetchRosterData for region ${region}:`, error);
      socket.emit("error", "Error fetching roster data");
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// REST API to serve quiz data
app.get("/getQuizData", async (req, res) => {
  const { region } = req.query;
  if (!region) {
    return res.status(400).json({ error: "Region parameter is required" });
  }
  try {
    const data = await getQuizData(region);
    res.json(data);
  } catch (error) {
    console.error("Error fetching quiz data:", error);
    res.status(500).json({ error: "Error fetching quiz data" });
  }
});

// Serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
