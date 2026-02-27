use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalInfo {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetAvailableTerminalsResult {
    pub success: bool,
    pub terminals: Vec<TerminalInfo>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenTerminalResult {
    pub success: bool,
    pub error: Option<String>,
}