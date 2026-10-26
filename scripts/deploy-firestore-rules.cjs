const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

async function deployRules() {
  const projectRoot = path.resolve(__dirname, '..');
  const keyPath = path.join(projectRoot, 'serviceAccountKey.json');
  const rulesPath = path.join(projectRoot, 'firestore.rules');

  if (!fs.existsSync(keyPath)) {
    console.error('Service account key not found at:', keyPath);
    process.exit(1);
  }

  if (!fs.existsSync(rulesPath)) {
    console.error('firestore.rules not found at:', rulesPath);
    process.exit(1);
  }

  const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const projectId = keyData.project_id;
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  console.log(`[DeployRules] Authenticating with project: ${projectId}...`);
  const auth = new GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase'],
  });

  const client = await auth.getClient();

  console.log(`[DeployRules] Creating new Firestore ruleset...`);
  const createRulesetUrl = `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`;
  const createResponse = await client.request({
    url: createRulesetUrl,
    method: 'POST',
    data: {
      source: {
        files: [
          {
            name: 'firestore.rules',
            content: rulesContent,
          },
        ],
      },
    },
  });

  const rulesetName = createResponse.data.name;
  console.log(`[DeployRules] Ruleset created successfully: ${rulesetName}`);

  console.log(`[DeployRules] Releasing ruleset to cloud.firestore...`);
  const releaseUrl = `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`;
  const releaseResponse = await client.request({
    url: releaseUrl,
    method: 'PATCH',
    data: {
      release: {
        name: `projects/${projectId}/releases/cloud.firestore`,
        rulesetName: rulesetName,
      },
    },
  });

  console.log(`[DeployRules] Release updated successfully at: ${releaseResponse.data.updateTime || new Date().toISOString()}`);
  console.log(`[DeployRules] Firestore Security Rules are now LIVE on Firebase project: ${projectId}`);
}

deployRules().catch((err) => {
  console.error('[DeployRules] Deployment failed:', err.message, err.response?.data || '');
  process.exit(1);
});

