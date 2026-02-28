CARD_TYPE_SCHEMAS = {
    "character": {
        "type": "object",
        "required": ["id", "type", "title", "payload"],
        "properties": {
            "id": {"type": "string"}, "type": {"const": "character"}, "title": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "links": {"type": "array", "items": {"type": "string"}},
            "payload": {"type": "object", "required": ["name", "identity", "appearance", "core_motivation", "personality_traits", "family_background", "voice", "boundaries", "relationships", "arc"]},
        },
    },
    "world": {"type": "object", "required": ["id", "type", "title", "payload"], "properties": {"id": {"type": "string"}, "type": {"const": "world"}, "title": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}, "links": {"type": "array", "items": {"type": "string"}}, "payload": {"type": "object"}}},
    "style": {
        "type": "object", "required": ["id", "type", "title", "payload"],
        "properties": {
            "id": {"type": "string"}, "type": {"const": "style"}, "title": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}, "links": {"type": "array", "items": {"type": "string"}},
            "payload": {"type": "object", "properties": {
                "active_style_sample_asset_ids": {"type": "array", "items": {"type": "string"}},
                "style_guide": {"type": "object"},
                "injection_policy": {"type": "object", "properties": {"max_examples": {"type": "integer"}, "max_chars_per_example": {"type": "integer"}}},
                "locks": {"type": "object", "properties": {"pov": {"type": "boolean"}, "tense": {"type": "boolean"}, "punctuation": {"type": "boolean"}, "taboo_words": {"type": "boolean"}}},
            }},
        },
    },
    "outline": {"type": "object", "required": ["id", "type", "title", "payload"], "properties": {"id": {"type": "string"}, "type": {"const": "outline"}, "title": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}, "links": {"type": "array", "items": {"type": "string"}}, "payload": {"type": "object"}}},
}

BLUEPRINT_SCHEMA = {
    "type": "object",
    "required": ["id", "story_type_id", "scene_plan"],
    "properties": {
        "id": {"type": "string"},
        "title": {"type": "string"},
        "story_type_id": {"type": "string"},
        "signals": {"type": "array", "items": {"type": "string", "enum": ["@@BEAT:N@@", "@@NEXT_SCENE@@"]}},
        "scene_plan": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["scene_id", "phase", "purpose", "situation", "choice_points"],
                "properties": {
                    "scene_id": {"type": "string"}, "phase": {"type": "string"}, "purpose": {"type": "string"}, "situation": {"type": "string"},
                    "choice_points": {"type": "array", "items": {"type": "string"}}, "cast": {"type": "array", "items": {"type": "string"}}, "beats": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}
