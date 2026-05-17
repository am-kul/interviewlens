import app from "./api/index.js";

const { AUTH_USERNAME, AUTH_PASSWORD, SESSION_SECRET } = process.env;
if (!AUTH_USERNAME || !AUTH_PASSWORD || !SESSION_SECRET) {
  console.error(
    "ERROR: AUTH_USERNAME, AUTH_PASSWORD, and SESSION_SECRET environment variables are required."
  );
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`InterviewLens running at http://localhost:${PORT}`);
});
