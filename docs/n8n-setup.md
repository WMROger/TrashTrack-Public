# n8n Setup Guide for RAG AI Chatbot

## Overview
This guide will help you set up an n8n workflow to handle RAG (Retrieval-Augmented Generation) requests from your React Native app using Groq API.

## Prerequisites
- n8n account (cloud or self-hosted)
- Groq API key
- Basic knowledge of n8n workflows

## Step 1: Create Webhook Trigger

1. **Create a new workflow** in n8n
2. **Add a Webhook node** as the trigger
3. **Configure the webhook:**
   - Method: `POST`
   - Path: `/webhook-test/a8735df2-a775-4ac0-b57f-6182ba0fedff` (or your preferred path)
   - **IMPORTANT: Enable CORS** (see CORS configuration below)

### CORS Configuration (CRITICAL)
To fix the CORS error you're experiencing, you need to configure CORS in your webhook node:

1. **In your Webhook node settings:**
   - Click on the webhook node
   - Go to **Settings** tab
   - Find **CORS** section
   - **Enable CORS**
   - Add these **Allowed Origins:**
     ```
     http://localhost:8081
     http://localhost:19006
     exp://localhost:19000
     http://192.168.1.*:8081
     http://192.168.1.*:19006
     ```
   - **Allowed Methods:** `POST, GET, OPTIONS`
   - **Allowed Headers:** `Content-Type, Authorization`
   - **Save the workflow**

2. **Alternative: Use a CORS node**
   If your n8n version doesn't have built-in CORS settings, add a **CORS node** after your webhook:
   - Add a **CORS node** as the second node
   - Configure it with the same settings above
   - Connect it between webhook and your processing nodes

## Step 1.5: Fix CORS Issues (IMPORTANT)

If you're still getting CORS errors, follow these steps:

### Option A: Use Wildcard CORS
1. **In your Webhook node settings:**
   - Go to **Settings** tab
   - Find **CORS** section
   - **Allowed Origins:** Use just `*` (single asterisk)
   - **Allowed Methods:** `POST, GET, OPTIONS`
   - **Allowed Headers:** `Content-Type, Authorization`

### Option B: Add CORS Node (Recommended)
If the webhook CORS settings don't work, add a dedicated CORS node:

1. **Add a CORS node** as the second node in your workflow
2. **Configure the CORS node:**
   - **Allowed Origins:** `*`
   - **Allowed Methods:** `POST, GET, OPTIONS`
   - **Allowed Headers:** `Content-Type, Authorization`
   - **Expose Headers:** Leave empty or add `Content-Type`
   - **Credentials:** Disabled
   - **Max Age:** `86400` (24 hours)

3. **Connect your workflow like this:**
   ```
   Webhook Trigger → CORS Node → Document Retrieval → Groq API → Response Formatting → Respond to Webhook
   ```

### Option C: Manual CORS Headers
If neither option works, add a **Code node** after your webhook to manually set CORS headers:

```javascript
// Add this as the second node in your workflow
const inputData = $input.first().json;
const headers = $input.first().headers;

// Set CORS headers manually
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

// Return the data with CORS headers
return {
  ...inputData,
  _corsHeaders: corsHeaders
};
```

Then in your **Respond to Webhook node**, set the headers:
```
Headers:
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

## Step 2: Document Retrieval (Code Node)

Add a **Code node** after the webhook (or CORS node) to handle document retrieval:

```javascript
// Sample documents (replace with your actual data)
const documents = [
  {
    id: 'doc1',
    content: 'TrashTrack is a waste management app that helps users track and manage their waste efficiently.',
    keywords: ['waste', 'management', 'tracking', 'recycling']
  },
  {
    id: 'doc2', 
    content: 'The app features include waste categorization, recycling tips, progress tracking, and community challenges.',
    keywords: ['features', 'categorization', 'tips', 'progress']
  }
];

// Get query from webhook
const query = $input.first().json.messageInput || '';

// Simple keyword-based retrieval
const relevantDocs = documents.filter(doc => {
  const queryLower = query.toLowerCase();
  return doc.keywords.some(keyword => 
    queryLower.includes(keyword.toLowerCase())
  ) || doc.content.toLowerCase().includes(queryLower);
});

// Return relevant context
return {
  query: query,
  context: relevantDocs.map(doc => doc.content).join('\n\n'),
  documentCount: relevantDocs.length
};
```

## Step 3: Groq API Integration

Add an **HTTP Request node** to call Groq API:

1. **Configure the HTTP Request node:**
   - Method: `POST`
   - URL: `https://api.groq.com/v1/chat/completions`
   - Headers:
     ```
     Authorization: Bearer YOUR_GROQ_API_KEY
     Content-Type: application/json
     ```
   - Body (JSON):
     ```json
     {
       "model": "llama3-8b-8192",
       "messages": [
         {
           "role": "system",
           "content": "You are an AI assistant for TrashTrack, a waste management app that helps users track and manage their waste efficiently. You provide helpful information about waste management, recycling tips, sustainability practices, and app features. Always be friendly, informative, and encourage sustainable practices. Answer only TrashTrack-related inquiries and redirect off-topic questions back to TrashTrack topics. IMPORTANT GUARDRAILS: 1) Never provide advice about illegal, dangerous, or harmful waste disposal methods. 2) Always promote safe, legal, and environmentally-friendly practices. 3) Focus on positive environmental impact and sustainability. 4) If asked about inappropriate topics, redirect to waste management and TrashTrack features. 5) Always encourage users to use TrashTrack for better waste management."
         },
         {
           "role": "user",
           "content": "Context:\n{{ $json.context }}\n\nQuestion:\n{{ $json.query }}\n\nAnswer based on the context and TrashTrack focus:"
         }
       ],
       "max_tokens": 1000,
       "temperature": 0.7
     }
     ```

2. **Set up API Key:**
   - Go to n8n **Settings** → **Credentials**
   - Add a new **HTTP Header Auth** credential
   - Name: `Groq API`
   - Header Name: `Authorization`
   - Header Value: `Bearer YOUR_GROQ_API_KEY`
   - Use this credential in your HTTP Request node

## Step 4: Response Formatting

Add a **Code node** to format the response:

```javascript
const groqResponse = $input.first().json;
const aiReply = groqResponse.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

return {
  reply: aiReply,
  timestamp: new Date().toISOString(),
  model: 'llama3-8b-8192',
  query: $('Document Retrieval').first().json.query
};
```

## Step 5: Response Node

Add a **Respond to Webhook node** to send the response back to your app:

1. **Configure the response:**
   - Response Code: `200`
   - Response Body: `{{ $json }}`
   - Headers:
     ```
     Content-Type: application/json
     Access-Control-Allow-Origin: *
     Access-Control-Allow-Methods: POST, GET, OPTIONS
     Access-Control-Allow-Headers: Content-Type, Authorization
     ```

## Step 6: Error Handling

Add error handling to your workflow:

1. **Add a Set node** for error responses
2. **Configure error handling** in each node
3. **Add a Respond to Webhook node** for errors

## Complete Workflow Structure

```
Webhook Trigger → CORS Node → Document Retrieval → Groq API → Response Formatting → Respond to Webhook
```

## Testing Your Workflow

1. **Activate your workflow** in n8n
2. **Test with curl:**
   ```bash
   curl -X POST https://vijay123eniola123.app.n8n.cloud/webhook-test/a8735df2-a775-4ac0-b57f-6182ba0fedff \
     -H "Content-Type: application/json" \
     -d '{"messageInput": "What features does TrashTrack have?"}'
   ```

3. **Test from your app** using the "Test Webhook" button

## Troubleshooting

### CORS Issues
- **Error:** "Access to fetch has been blocked by CORS policy"
- **Solution:** Enable CORS in webhook node settings (see Step 1.5)

### API Key Issues
- **Error:** "401 Unauthorized" from Groq
- **Solution:** Check your Groq API key in n8n credentials

### Workflow Not Responding
- **Error:** "Failed to fetch" or timeout
- **Solution:** Check if workflow is activated and webhook URL is correct

### Response Format Issues
- **Error:** App can't parse response
- **Solution:** Ensure response format matches what your app expects

## Security Considerations

1. **API Key Security:** Store Groq API key in n8n credentials, not in workflow
2. **Input Validation:** Validate query input in your workflow
3. **Rate Limiting:** Consider adding rate limiting to prevent abuse
4. **Error Logging:** Log errors for debugging without exposing sensitive data

## Advanced Features

### Document Management
- Store documents in n8n variables or external database
- Implement vector search for better retrieval
- Add document versioning and updates

### Caching
- Cache frequent queries to reduce API calls
- Implement response caching in n8n

### Analytics
- Log queries and responses for analytics
- Track usage patterns and popular questions

## Deployment

1. **Production URLs:** Update CORS origins for production
2. **Environment Variables:** Use n8n variables for different environments
3. **Monitoring:** Set up alerts for workflow failures
4. **Backup:** Export and backup your workflow configuration 