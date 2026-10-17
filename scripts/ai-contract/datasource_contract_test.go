package plugin

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// Runs inside a temporary copy of the consumer package, using its actual decoders.
func TestPanelWireContract(t *testing.T) {
	content, err := os.ReadFile(os.Getenv("FLINT_AI_CONTRACT_FIXTURES"))
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Backend  string          `json:"backend"`
		Generate json.RawMessage `json:"generate"`
		Repair   json.RawMessage `json:"repair"`
	}
	if err := json.Unmarshal(content, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures) != 4 {
		t.Fatalf("expected every backend, got %d", len(fixtures))
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Backend, func(t *testing.T) {
			if _, err := decodeGenerateRequest(strings.NewReader(string(fixture.Generate))); err != nil {
				t.Fatalf("generate: %v", err)
			}
			if _, err := decodeRepairRequest(strings.NewReader(string(fixture.Repair))); err != nil {
				t.Fatalf("repair: %v", err)
			}
			var polluted map[string]any
			if err := json.Unmarshal(fixture.Generate, &polluted); err != nil {
				t.Fatal(err)
			}
			polluted["unexpectedPanelField"] = true
			bad, _ := json.Marshal(polluted)
			if _, err := decodeGenerateRequest(strings.NewReader(string(bad))); err == nil {
				t.Fatal("consumer stopped rejecting unknown fields")
			}
		})
	}
}
