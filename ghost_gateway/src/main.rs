use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

// Configuration structure
#[derive(Debug, Clone)]
struct Config {
    pub supabase_url: String,
    pub supabase_anon_key: String,
    pub whatsapp_verify_token: String,
    pub whatsapp_access_token: String,
    pub whatsapp_app_secret: String,
    pub webhook_verify_enabled: bool,
}

impl Config {
    fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Config {
            supabase_url: std::env::var("SUPABASE_URL")
                .unwrap_or_else(|_| "http://localhost:54321".to_string()),
            supabase_anon_key: std::env::var("SUPABASE_ANON_KEY")
                .expect("SUPABASE_ANON_KEY environment variable must be set"),
            whatsapp_verify_token: std::env::var("WHATSAPP_VERIFY_TOKEN")
                .expect("WHATSAPP_VERIFY_TOKEN environment variable must be set"),
            whatsapp_access_token: std::env::var("WHATSAPP_ACCESS_TOKEN")
                .expect("WHATSAPP_ACCESS_TOKEN environment variable must be set"),
            whatsapp_app_secret: std::env::var("WHATSAPP_APP_SECRET")
                .expect("WHATSAPP_APP_SECRET environment variable must be set"),
            webhook_verify_enabled: std::env::var("WEBHOOK_VERIFY_ENABLED")
                .unwrap_or_else(|_| "true".to_string())
                .parse()
                .unwrap_or(true),
        })
    }
}

// Application state
#[derive(Clone)]
struct AppState {
    config: Config,
    http_client: reqwest::Client,
    // Simple in-memory cache for recent requests to prevent replay attacks
    recent_requests: Arc<RwLock<HashMap<String, DateTime<Utc>>>>,
}

// WhatsApp webhook payload structures
#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppWebhookPayload {
    #[serde(rename = "object")]
    object: String,
    entry: Vec<WhatsAppEntry>,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppEntry {
    id: String,
    changes: Vec<WhatsAppChange>,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppChange {
    value: WhatsAppValue,
    field: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppValue {
    messaging_product: String,
    #[serde(default)]
    metadata: Option<WhatsAppMetadata>,
    #[serde(default)]
    contacts: Option<Vec<WhatsAppContact>>,
    #[serde(default)]
    messages: Option<Vec<WhatsAppMessage>>,
    #[serde(default)]
    statuses: Option<Vec<WhatsAppStatus>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppMetadata {
    display_phone_number: String,
    phone_number_id: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppContact {
    wa_id: String,
    profile: Option<WhatsAppProfile>,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppProfile {
    name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppMessage {
    from: String,
    id: String,
    timestamp: String,
    r#type: String,
    text: Option<WhatsAppText>,
    image: Option<WhatsAppMedia>,
    video: Option<WhatsAppMedia>,
    audio: Option<WhatsAppMedia>,
    document: Option<WhatsAppMedia>,
    location: Option<WhatsAppLocation>,
    contacts: Option<Vec<WhatsAppContactMessage>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppText {
    body: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppMedia {
    id: String,
    mime_type: Option<String>,
    sha256: String,
    caption: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppLocation {
    latitude: f64,
    longitude: f64,
    name: Option<String>,
    address: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppContactMessage {
    addresses: Option<Vec<ContactAddress>>,
    birthday: Option<String>,
    emails: Option<Vec<ContactEmail>>,
    name: ContactName,
    org: Option<ContactOrg>,
    phones: Option<Vec<ContactPhone>>,
    urls: Option<Vec<ContactUrl>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ContactAddress {
    street: Option<String>,
    city: Option<String>,
    state: Option<String>,
    zip: Option<String>,
    country: Option<String>,
    country_code: Option<String>,
    r#type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ContactEmail {
    email: String,
    r#type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ContactName {
    formatted_name: String,
    first_name: Option<String>,
    last_name: Option<String>,
    middle_name: Option<String>,
    suffix: Option<String>,
    prefix: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ContactOrg {
    company: Option<String>,
    department: Option<String>,
    title: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ContactPhone {
    phone: String,
    r#type: Option<String>,
    wa_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ContactUrl {
    url: String,
    r#type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct WhatsAppStatus {
    id: String,
    status: String,
    timestamp: String,
    recipient_id: String,
}

// Database interaction structures
#[derive(Serialize, Debug)]
struct InteractionQueueEntry {
    id: Uuid,
    source: String,
    source_id: String,
    student_external_id: String,
    student_display_name: Option<String>,
    message_type: String,
    raw_content: String,
    timestamp_utc: DateTime<Utc>,
    enrichment: serde_json::Value,
    processing_status: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Load configuration
    let config = Config::from_env()?;
    info!("Starting Ghost Gateway with configuration loaded");

    // Create HTTP client
    let http_client = reqwest::Client::new();

    // Create application state
    let state = AppState {
        config,
        http_client,
        recent_requests: Arc::new(RwLock::new(HashMap::new())),
    };

    // Build the router
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/webhook", get(webhook_verify_handler).post(webhook_receive_handler))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state);

    // Get port from environment or default to 8080
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .expect("PORT must be a number");
    
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    info!("Ghost Gateway listening on port {}", port);

    // Start the server
    axum::serve(listener, app).await?;

    Ok(())
}

// Health check endpoint - keeps Render awake
async fn health_handler() -> impl IntoResponse {
    info!("Health check requested");
    Json(serde_json::json!({
        "status": "healthy",
        "timestamp": Utc::now().to_rfc3339(),
        "service": "ghost_gateway"
    }))
}

// Webhook verification handler (for WhatsApp)
async fn webhook_verify_handler(
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    debug!("Webhook verification requested: {:?}", params);

    // Verify the token
    if let Some(mode) = params.get("hub.mode") {
        if mode == "subscribe" {
            if let Some(token) = params.get("hub.verify_token") {
                if token == &state.config.whatsapp_verify_token {
                    if let Some(challenge) = params.get("hub.challenge") {
                        info!("Webhook verification successful");
                        return (StatusCode::OK, challenge.clone());
                    }
                }
            }
        }
    }

    warn!("Webhook verification failed");
    (StatusCode::FORBIDDEN, "Verification failed".to_string())
}

// Main webhook handler - receives WhatsApp messages
async fn webhook_receive_handler(
    State(state): State<AppState>,
    axum::extract::RawBody(body): axum::extract::RawBody,
) -> impl IntoResponse {
    info!("Received webhook payload");

    // Read the request body
    let body_bytes = match http_body_util::BodyExt::collect(body).await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            error!("Failed to read request body: {}", e);
            return (StatusCode::BAD_REQUEST, "Invalid body".to_string());
        }
    };

    let body_str = String::from_utf8_lossy(&body_bytes);

    // Verify signature if enabled
    if state.config.webhook_verify_enabled {
        if let Some(signature) = axum::http::HeaderMap::from_request_parts(
            &mut axum::http::request::Parts::default(),
            &body_bytes,
        )
        .ok()
        .and_then(|headers| headers.get("X-Hub-Signature-256"))
        .and_then(|header| header.to_str().ok())
        {
            if !verify_whatsapp_signature(&body_bytes, signature, &state.config.whatsapp_app_secret) {
                error!("Webhook signature verification failed");
                return (StatusCode::FORBIDDEN, "Invalid signature".to_string());
            }
        } else {
            error!("Missing signature header");
            return (StatusCode::FORBIDDEN, "Missing signature".to_string());
        }
    }

    // Parse the WhatsApp payload
    let payload: WhatsAppWebhookPayload = match serde_json::from_str(&body_str) {
        Ok(payload) => payload,
        Err(e) => {
            error!("Failed to parse WhatsApp payload: {}", e);
            return (StatusCode::BAD_REQUEST, "Invalid JSON".to_string());
        }
    };

    // Process the payload
    if let Err(e) = process_whatsapp_payload(&state, payload).await {
        error!("Failed to process WhatsApp payload: {}", e);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Processing failed".to_string());
    }

    // Return success
    (StatusCode::OK, "Success".to_string())
}

// Verify WhatsApp signature using HMAC-SHA256
fn verify_whatsapp_signature(payload: &[u8], signature: &str, app_secret: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    // Remove "sha256=" prefix if present
    let expected_sig = signature.strip_prefix("sha256=").unwrap_or(signature);

    // Create HMAC with app secret
    let mut mac = HmacSha256::new_from_slice(app_secret.as_bytes()).expect("HMAC creation failed");
    mac.update(payload);
    let result = mac.finalize();
    let actual_sig = hex::encode(result.into_bytes());

    // Compare signatures
    hmac::digest::Mac::verify_slice(
        &HmacSha256::new_from_slice(app_secret.as_bytes()).expect("HMAC creation failed"),
        payload,
        &hex::decode(expected_sig).unwrap_or_default(),
    )
    .is_ok()
}

// Process the WhatsApp payload and insert into Supabase
async fn process_whatsapp_payload(
    state: &AppState,
    payload: WhatsAppWebhookPayload,
) -> Result<(), Box<dyn std::error::Error>> {
    for entry in payload.entry {
        for change in entry.changes {
            if change.field != "messages" {
                continue;
            }

            let value = change.value;
            
            // Extract contact information
            let contact_info = value.contacts.and_then(|contacts| contacts.first().cloned());
            
            // Process messages
            if let Some(messages) = value.messages {
                for message in messages {
                    // Check for replay attacks
                    if is_replay_attack(&state.recent_requests, &message.id).await {
                        warn!("Replay attack detected for message ID: {}", message.id);
                        continue;
                    }

                    // Create interaction queue entry
                    let interaction_entry = create_interaction_queue_entry(
                        &contact_info,
                        &message,
                        &value.metadata,
                    ).await?;

                    // Insert into Supabase
                    insert_into_supabase(&state, &interaction_entry).await?;

                    info!("Successfully processed message from {} with ID {}", 
                          message.from, message.id);
                }
            }

            // Process statuses (delivery receipts, read receipts)
            if let Some(statuses) = value.statuses {
                for status in statuses {
                    info!("Received status update for recipient {}: {}", 
                          status.recipient_id, status.status);
                    
                    // You can add status processing logic here if needed
                }
            }
        }
    }

    Ok(())
}

// Check if this is a replay attack by checking recent requests
async fn is_replay_attack(
    recent_requests: &Arc<RwLock<HashMap<String, DateTime<Utc>>>>,
    message_id: &str,
) -> bool {
    let now = Utc::now();
    let cutoff = now - chrono::Duration::minutes(5); // 5 minute window

    let mut requests = recent_requests.write().await;
    
    // Clean up old entries
    requests.retain(|_, &mut timestamp| timestamp > cutoff);
    
    // Check if this message ID was recently seen
    if requests.contains_key(message_id) {
        return true;
    }
    
    // Add this message ID to recent requests
    requests.insert(message_id.to_string(), now);
    
    false
}

// Create interaction queue entry from WhatsApp message
async fn create_interaction_queue_entry(
    contact_info: &Option<WhatsAppContact>,
    message: &WhatsAppMessage,
    metadata: &Option<WhatsAppMetadata>,
) -> Result<InteractionQueueEntry, Box<dyn std::error::Error>> {
    use std::process;

    // Extract content based on message type
    let content = match &message.r#type[..] {
        "text" => message.text.as_ref().map(|t| t.body.clone()).unwrap_or_default(),
        "image" => format!("Image message: {}", 
            message.image.as_ref().and_then(|img| img.caption.clone()).unwrap_or_else(|| "Image".to_string())),
        "video" => format!("Video message: {}", 
            message.video.as_ref().and_then(|vid| vid.caption.clone()).unwrap_or_else(|| "Video".to_string())),
        "audio" => "Audio message".to_string(),
        "document" => format!("Document: {}", 
            message.document.as_ref().and_then(|doc| doc.caption.clone()).unwrap_or_else(|| "Document".to_string())),
        "location" => format!("Location: ({}, {})", 
            message.location.as_ref().map(|loc| loc.latitude).unwrap_or(0.0),
            message.location.as_ref().map(|loc| loc.longitude).unwrap_or(0.0)),
        "contacts" => "Contact card".to_string(),
        _ => format!("Unsupported message type: {}", message.r#type),
    };

    // Create enrichment data
    let enrichment = serde_json::json!({
        "language_detected": detect_language(&content).await,
        "message_length": content.len(),
        "has_media": message.r#type != "text",
        "reply_context": extract_reply_context(&message).await,
        "message_type_specific_data": match &message.r#type[..] {
            "image" => serde_json::json!(message.image),
            "video" => serde_json::json!(message.video),
            "audio" => serde_json::json!(message.audio),
            "document" => serde_json::json!(message.document),
            "location" => serde_json::json!(message.location),
            _ => serde_json::json!(null),
        }
    });

    // Convert timestamp to DateTime<Utc>
    let timestamp_seconds: i64 = message.timestamp.parse().unwrap_or(Utc::now().timestamp());
    let timestamp_utc = DateTime::from_timestamp(timestamp_seconds, 0).unwrap_or(Utc::now());

    Ok(InteractionQueueEntry {
        id: Uuid::new_v4(),
        source: "whatsapp".to_string(),
        source_id: message.id.clone(),
        student_external_id: message.from.clone(),
        student_display_name: contact_info.as_ref().and_then(|c| c.profile.as_ref()?.name.clone()),
        message_type: message.r#type.clone(),
        raw_content: content,
        timestamp_utc,
        enrichment,
        processing_status: "pending".to_string(),
    })
}

// Simple language detection (placeholder - would be more sophisticated in production)
async fn detect_language(text: &str) -> String {
    // This is a very basic placeholder
    // In production, you'd use a proper language detection library
    if text.contains("na ") || text.contains("dey") || text.contains("una") {
        "pcm".to_string() // Nigerian Pidgin
    } else {
        "en".to_string() // English
    }
}

// Extract reply context if this is a reply to another message
async fn extract_reply_context(message: &WhatsAppMessage) -> Option<String> {
    // WhatsApp replies include context in the message structure
    // This is a placeholder - would extract actual reply context in production
    None
}

// Insert interaction into Supabase
async fn insert_into_supabase(
    state: &AppState,
    entry: &InteractionQueueEntry,
) -> Result<(), Box<dyn std::error::Error>> {
    let url = format!("{}/rest/v1/interaction_queue", state.config.supabase_url);
    
    let response = state.http_client
        .post(&url)
        .header("apikey", &state.config.supabase_anon_key)
        .header("Authorization", format!("Bearer {}", state.config.supabase_anon_key))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates")
        .json(entry)
        .send()
        .await?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        error!("Failed to insert into Supabase: {}", error_text);
        return Err(format!("Supabase insert failed: {}", error_text).into());
    }

    info!("Successfully inserted interaction into Supabase: {}", entry.source_id);
    Ok(())
}
