# Digital Marketing AI Platform

A full-stack AI-powered digital marketing platform for managing Meta, Google, and TikTok ad campaigns with AI creative generation, performance analytics, and trend intelligence.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Digital Marketing AI Platform                     │
├─────────────┬─────────────────────┬──────────────────┬─────────────┤
│   Frontend  │      Backend API    │   n8n Workflows  │  Databases  │
│  React/Vite │  Node.js + Express  │  Video Pipeline  │ PostgreSQL  │
│  Tailwind   │  Socket.IO (WS)     │  Trend Analysis  │   Redis     │
│  Recharts   │  Bull Queues        │  Ad Copy Gen     │             │
│  Port: 3000 │  Port: 3001         │  Port: 5678      │  Port: 5432 │
└─────────────┴─────────────────────┴──────────────────┴─────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     External Integrations                            │
├──────────┬──────────┬──────────┬──────────┬──────────┬─────────────┤
│ Meta Ads │  Google  │  TikTok  │  OpenAI  │ElevenLabs│  PiAPI      │
│ Graph    │  Ads API │ Business │  GPT-4   │  TTS     │Flux/Kling   │
│ API v19  │  v15     │  API v3  │          │          │             │
└──────────┴──────────┴──────────┴──────────┴──────────┴─────────────┘
```

## Features

### Analytics Dashboard
- Real-time KPI monitoring: ROAS, CTR, CPA, CAC, AOV, LTV
- Cross-platform performance comparison (Meta, Google, TikTok)
- Time-series charts with 7/14/30/90-day ranges
- Top-performing campaigns ranked by any metric

### Campaign Management
- Sync campaigns from all connected ad platforms
- Status tracking: active, paused, draft, archived
- Budget monitoring and performance metrics per campaign

### Creative Studio
- **AI Ad Copy**: Generate 2-5 variants per platform with GPT-4
- **Video Pipeline**: Brief → Script → Images (Flux) → Video (Kling) → Voiceover (ElevenLabs) → Render (Creatomate)
- **Voiceover**: ElevenLabs text-to-speech with 6 voice options
- **Creative Scoring**: AI-powered 5-dimensional scoring:
  - Hook Score (35% weight) — first-3-second attention
  - Retention Score (25%) — engagement throughout
  - CTA Score (25%) — conversion drive
  - Emotional Score (15%) — psychological resonance

### Trend Engine
- Daily automated trend scraping via Apify (TikTok + Instagram)
- GPT-4 analysis of trending hashtags, sounds, formats
- Viral hook templates with retention boost estimates
- Prioritized action recommendations with effort ratings

### Platform Integrations
- **Meta Ads**: OAuth2 with long-lived token exchange, campaign + insights sync
- **Google Ads**: OAuth2 with refresh tokens, GAQL queries
- **TikTok Ads**: TikTok Business API v1.3 with advertiser account linking

## Quick Start

### Prerequisites
- Docker + Docker Compose
- Node.js 18+ (for local development)

### 1. Clone and configure

```bash
git clone <repo>
cd DigitalMarketingBYmoSES
cp .env.example .env
# Edit .env with your credentials
```

### 2. Generate secure keys

```bash
# JWT Secret
openssl rand -base64 64

# JWT Refresh Secret (different from above)
openssl rand -base64 64

# Encryption Key (exactly 32 chars)
openssl rand -hex 16

# n8n Encryption Key
openssl rand -hex 32
```

### 3. Start with Docker Compose

```bash
docker-compose up -d

# Check all services are healthy
docker-compose ps

# View backend logs
docker-compose logs -f backend
```

### 4. Access the platform

| Service  | URL                      | Credentials          |
|----------|--------------------------|----------------------|
| Frontend | http://localhost:3000    | Register new account |
| Backend  | http://localhost:3001    | API                  |
| n8n      | http://localhost:5678    | .env N8N_BASIC_AUTH  |

### 5. Import n8n workflows

1. Open n8n at http://localhost:5678
2. Go to Workflows → Import
3. Import each JSON from `n8n-workflows/`:
   - `video-production-pipeline.json`
   - `trend-analysis.json`
   - `ad-copy-generator.json`
4. Configure credentials in n8n (OpenAI, ElevenLabs, Apify, Slack)
5. Activate the workflows

## Local Development

### Backend

```bash
cd backend
cp .env.example .env
# Configure your .env
npm install
# Start PostgreSQL and Redis (or use docker-compose for just infra)
docker-compose up postgres redis -d
npm run dev
```

### Frontend

```bash
cd frontend
npm install
# Set VITE_API_URL in a .env.local file
echo "VITE_API_URL=http://localhost:3001" > .env.local
npm run dev
```

## API Reference

### Authentication
```
POST /api/auth/register     - Create account
POST /api/auth/login        - Login
POST /api/auth/refresh      - Refresh token
POST /api/auth/logout       - Logout
GET  /api/auth/me           - Get current user
```

### Analytics
```
GET /api/analytics/overview         - Aggregate KPIs
GET /api/analytics/timeseries       - Daily data for charts
GET /api/analytics/by-platform      - Platform breakdown
GET /api/analytics/top-campaigns    - Ranked campaigns
GET /api/analytics/ltv              - LTV/CAC metrics
```

### Campaigns
```
GET  /api/campaigns         - List campaigns
GET  /api/campaigns/:id     - Get campaign + analytics
POST /api/campaigns         - Create campaign
PUT  /api/campaigns/:id     - Update campaign
POST /api/campaigns/sync    - Sync from ad platforms
```

### Creative & AI
```
GET  /api/creative              - List creatives with scores
POST /api/creative/:id/score    - Score creative with AI
POST /api/ai/ad-copy            - Generate ad copy variants
POST /api/ai/video              - Trigger video pipeline
GET  /api/ai/video/status/:id   - Poll video job status
POST /api/ai/voiceover          - Generate voiceover
POST /api/ai/analyze            - Analyze campaign performance
```

### Platform Accounts
```
GET  /api/accounts                    - List connected accounts
DELETE /api/accounts/:id              - Disconnect account
GET  /api/accounts/meta/connect       - Get Meta OAuth URL
GET  /api/accounts/google/connect     - Get Google OAuth URL
GET  /api/accounts/tiktok/connect     - Get TikTok OAuth URL
```

## Environment Variables

See `.env.example` for the complete list. Minimum required variables:
- `DB_PASSWORD` — PostgreSQL password
- `JWT_SECRET` — JWT signing secret (32+ chars)
- `JWT_REFRESH_SECRET` — JWT refresh signing secret
- `ENCRYPTION_KEY` — Token encryption key (exactly 32 chars)

AI features require:
- `OPENAI_API_KEY` — For GPT-4 analysis, copy generation, scoring
- `ELEVENLABS_API_KEY` — For voiceover generation

Platform integrations require:
- `META_APP_ID` + `META_APP_SECRET`
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_ADS_DEVELOPER_TOKEN`
- `TIKTOK_APP_ID` + `TIKTOK_APP_SECRET`

## Security

- JWT-based authentication with refresh token rotation
- AES-256-GCM encryption for all OAuth tokens at rest
- Rate limiting: 100 req/15min API, 10 req/15min auth, 20 req/hr AI
- CORS with configurable origin allowlist
- Helmet.js security headers
- Non-root Docker containers
- Input validation on all endpoints

## Tech Stack

| Layer       | Technology                                    |
|-------------|-----------------------------------------------|
| Frontend    | React 18, Vite, TailwindCSS, Recharts         |
| Backend     | Node.js 20, Express 4, Socket.IO              |
| Database    | PostgreSQL 16 with pgcrypto extension         |
| Cache/Queue | Redis 7, Bull                                 |
| Automation  | n8n (self-hosted)                             |
| AI/ML       | OpenAI GPT-4, ElevenLabs, PiAPI (Flux/Kling)  |
| Deployment  | Docker, Docker Compose                        |

## License

MIT
