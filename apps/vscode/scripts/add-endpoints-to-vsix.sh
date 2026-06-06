#!/bin/bash
set -euo pipefail

# Script to add endpoints.json to a VSIX package for enterprise distribution
# Usage: ./add-endpoints-to-vsix.sh <source.vsix> <output.vsix> <endpoints.json>

if [ "$#" -ne 3 ]; then
    echo "Error: Invalid number of arguments"
    echo "Usage: $0 <source.vsix> <output.vsix> <endpoints.json>"
    echo ""
    echo "Example:"
    echo "  $0 cline-3.55.0.vsix cline-3.55.0-enterprise.vsix endpoints.json"
    exit 1
fi

SOURCE_VSIX="$1"
OUTPUT_VSIX="$2"
ENDPOINTS_JSON="$3"

# Validate inputs
if [ ! -f "$SOURCE_VSIX" ]; then
    echo "Error: Source VSIX file not found: $SOURCE_VSIX"
    exit 1
fi

if [ ! -f "$ENDPOINTS_JSON" ]; then
    echo "Error: endpoints.json file not found: $ENDPOINTS_JSON"
    exit 1
fi

# Validate endpoints.json is valid JSON
if ! jq empty "$ENDPOINTS_JSON" 2>/dev/null; then
    echo "Error: $ENDPOINTS_JSON is not valid JSON"
    exit 1
fi

# Validate required fields exist
REQUIRED_FIELDS=("appBaseUrl" "apiBaseUrl" "mcpBaseUrl")
for field in "${REQUIRED_FIELDS[@]}"; do
    if ! jq -e ".$field" "$ENDPOINTS_JSON" > /dev/null 2>&1; then
        echo "Error: Missing required field '$field' in $ENDPOINTS_JSON"
        exit 1
    fi
    
    # Validate field is a non-empty string
    value=$(jq -r ".$field" "$ENDPOINTS_JSON")
    if [ -z "$value" ] || [ "$value" = "null" ]; then
        echo "Error: Field '$field' must be a non-empty string"
        exit 1
    fi
    
    # Validate URL format (basic check)
    if ! [[ "$value" =~ ^https?:// ]]; then
        echo "Error: Field '$field' must be a valid URL (got: $value)"
        exit 1
    fi
done

echo "✓ Validated endpoints.json"

# Resolve absolute path for output file before changing directories
OUTPUT_VSIX_ABS=$(cd "$(dirname "$OUTPUT_VSIX")" && pwd)/$(basename "$OUTPUT_VSIX")

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Extracting VSIX..."
unzip -q "$SOURCE_VSIX" -d "$TEMP_DIR"

PACKAGE_JSON="$TEMP_DIR/extension/package.json"
if [ ! -f "$PACKAGE_JSON" ]; then
    echo "Error: VSIX is missing extension/package.json"
    exit 1
fi

if ! jq -e '.name == "codevibe" and .publisher == "atnumridha" and .displayName == "CodeVibe"' "$PACKAGE_JSON" > /dev/null 2>&1; then
    echo "Error: VSIX package manifest is not the CodeVibe Cursor-parity manifest"
    exit 1
fi

REQUIRED_CONFIG_KEYS=(
    "cline.openAiCodex.authSource"
    "cline.cursorCompatibility.enabled"
    "cline.cursorCompatibility.deepLinks.enabled"
    "cline.cursorCompatibility.retrievalIndexing.privacyGate"
    "cline.cursorCompatibility.sandboxPolicy"
    "cline.cursorCompatibility.safeBrowserEvaluate.enabled"
)
for key in "${REQUIRED_CONFIG_KEYS[@]}"; do
    if ! jq -e --arg key "$key" '.contributes.configuration.properties[$key]' "$PACKAGE_JSON" > /dev/null 2>&1; then
        echo "Error: VSIX package manifest is missing Cursor-parity config key: $key"
        exit 1
    fi
done

echo "✓ Validated CodeVibe Cursor-parity VSIX manifest"

# Copy endpoints.json to extension directory
echo "Adding endpoints.json to extension/..."
cp "$ENDPOINTS_JSON" "$TEMP_DIR/extension/endpoints.json"

# Repackage VSIX
echo "Repackaging VSIX..."
cd "$TEMP_DIR"
zip -q -r "$OUTPUT_VSIX_ABS" .
cd - > /dev/null

echo "✓ Successfully created $OUTPUT_VSIX with bundled endpoints.json"
echo ""
echo "The package is ready for enterprise distribution."
echo "When installed, CodeVibe will automatically use the bundled configuration."
