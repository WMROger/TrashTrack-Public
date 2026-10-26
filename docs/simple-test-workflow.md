# Simple n8n Test Workflow for CORS Debugging

## Quick Test Workflow

If you're still having CORS issues, let's create a minimal test workflow to isolate the problem:

### Step 1: Create Minimal Test Workflow

1. **Create a new workflow** in n8n
2. **Add only these 2 nodes:**

#### Node 1: Webhook Trigger
- **Method:** POST
- **Path:** `/test-cors`
- **CORS Settings:** Disable CORS completely (turn it off)

#### Node 2: Respond to Webhook
- **Response Code:** 200
- **Response Body:**
```json
{
  "message": "CORS test successful",
  "timestamp": "{{ new Date().toISOString() }}",
  "received": "{{ $json }}"
}
```
- **Headers:**
```
Content-Type: application/json
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

### Step 2: Test the Simple Workflow

1. **Activate the workflow**
2. **Get the webhook URL** (should be something like `https://vijay123eniola123.app.n8n.cloud/webhook/test-cors`)
3. **Test with curl:**
```bash
curl -X POST https://vijay123eniola123.app.n8n.cloud/webhook/test-cors \
  -H "Content-Type: application/json" \
  -d '{"test": "hello world"}'
```

4. **If curl works, test from your app** by temporarily updating the webhook URL in your config

### Step 3: If Simple Workflow Works

If the simple workflow works, then the issue is in your main workflow. Add nodes one by one:

1. **Add CORS node** after webhook
2. **Test again**
3. **Add document retrieval**
4. **Test again**
5. **Add Groq API call**
6. **Test again**

### Step 4: Alternative - Use a Different Approach

If CORS continues to be an issue, try these alternatives:

#### Option A: Use a Proxy
Create a simple proxy server or use a service like:
- **CORS Anywhere** (for testing only)
- **Your own proxy** using Express.js

#### Option B: Use n8n HTTP Request Instead
Instead of calling n8n from your app, have n8n poll your app or use a different trigger.

#### Option C: Use Firebase Functions as Proxy
Use Firebase Functions to call n8n, then call Firebase from your app.

## Debugging Steps

### 1. Check n8n Logs
- Go to your n8n workflow executions
- Check if requests are reaching n8n
- Look for any error messages

### 2. Check Browser Network Tab
- Open browser dev tools
- Go to Network tab
- Send a test message
- Look for the failed request
- Check the response headers

### 3. Test Different Origins
Try updating your app's webhook URL to test different scenarios:
- `http://localhost:3000` (if you have a different port)
- `http://127.0.0.1:8081`
- Your actual IP address

### 4. Check n8n Version
Some n8n versions have CORS issues. Check your version and consider updating.

## Quick Fix Commands

If you want to test quickly, you can also try:

### Test with Postman
1. **Open Postman**
2. **Create a POST request** to your webhook URL
3. **Add headers:**
   - `Content-Type: application/json`
4. **Add body:**
   ```json
   {
     "query": "test message"
   }
   ```
5. **Send the request**

### Test with JavaScript
```javascript
fetch('https://vijay123eniola123.app.n8n.cloud/webhook/a8735df2-a775-4ac0-b57f-6182ba0fedff', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: 'test message'
  })
})
.then(response => response.json())
.then(data => console.log('Success:', data))
.catch(error => console.error('Error:', error));
```

## Common CORS Solutions

### 1. n8n Cloud Specific
If you're using n8n.cloud, try:
- **Different webhook path**
- **Different workflow**
- **Contact n8n support** if the issue persists

### 2. Self-Hosted n8n
If you're self-hosting n8n:
- **Check nginx/apache configuration**
- **Add CORS headers in reverse proxy**
- **Update n8n to latest version**

### 3. Development Workaround
For development only, you can:
- **Use browser extensions** to disable CORS
- **Use a local proxy server**
- **Test on mobile device** (different CORS behavior)

## Next Steps

1. **Try the simple test workflow first**
2. **If it works, gradually add complexity**
3. **If it doesn't work, try the alternatives**
4. **Let me know what happens** and we'll troubleshoot further 