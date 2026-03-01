CARD_TYPE_SCHEMAS = {
    "character": {
        "type": "object",
        "required": ["id", "type", "title", "payload"],
        "properties": {
            "id": {"type": "string"}, "type": {"const": "character"}, "title": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "links": {"type": "array", "items": {"type": "string"}},
            "payload": {
                "type": "object",
                "required": ["name", "identity", "appearance", "core_motivation", "personality_traits", "family_background", "voice", "boundaries", "relationships", "arc"],
                "properties": {
                    "name": {"type": "string"},
                    "identity": {"type": "string"},
                    "appearance": {"type": "string"},
                    "core_motivation": {"type": "string"},
                    "personality_traits": {"type": "array", "items": {"type": "string"}},
                    "family_background": {"type": "string"},
                    "voice": {"type": "string"},
                    "boundaries": {"type": "array", "items": {"type": "string"}},
                    "relationships": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"target": {"type": "string"}, "type": {"type": "string"}},
                        },
                    },
                    "arc": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"beat": {"type": "string"}, "goal": {"type": "string"}},
                        },
                    },
                    "role": {
                        "type": "string",
                        "enum": ["protagonist", "supporting", "antagonist", "other"],
                        "default": "other",
                    },
                    "importance": {"type": "integer", "minimum": 1, "maximum": 5, "default": 3},
                    "age": {"type": "integer", "minimum": 0, "maximum": 200},
                },
            },
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
    "outline": {
        "type": "object", "required": ["id", "type", "title", "payload"],
        "properties": {
            "id": {"type": "string"}, "type": {"const": "outline"}, "title": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}, "links": {"type": "array", "items": {"type": "string"}},
            "payload": {
                "type": "object",
                "properties": {
                    "beats": {"type": "array", "items": {"type": "object"}},
                    "technique_prefs": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "scope": {"type": "string", "enum": ["arc", "chapter", "beat"]},
                                "ref": {"type": "string"},
                                "categories": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "category_id": {"type": "string"},
                                            "intensity": {"type": "string", "enum": ["low", "med", "high"]},
                                            "weight": {"type": "number"},
                                            "notes": {"type": "string"},
                                        },
                                    },
                                },
                                "techniques": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "technique_id": {"type": "string"},
                                            "intensity": {"type": "string", "enum": ["low", "med", "high"]},
                                            "notes": {"type": "string"},
                                            "weight": {"type": "number"},
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
    "technique_category": {
        "type": "object", "required": ["id", "type", "title", "payload"],
        "properties": {
            "id": {"type": "string"}, "type": {"const": "technique_category"}, "title": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}}, "links": {"type": "array", "items": {"type": "string"}},
            "payload": {"type": "object", "properties": {
                "name": {"type": "string"},
                "parent_id": {"type": "string"},
                "description": {"type": "string"},
                "sort_order": {"type": "integer"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "core_techniques": {"type": "array", "items": {"type": "string"}},
            }},
        },
    },
    "technique": {
        "type": "object", "required": ["id", "type", "title", "payload"],
        "properties": {
            "id": {"type": "string"}, "type": {"const": "technique"}, "title": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}}, "links": {"type": "array", "items": {"type": "string"}},
            "payload": {"type": "object", "properties": {
                "name": {"type": "string"},
                "category_id": {"type": "string"},
                "aliases": {"type": "array", "items": {"type": "string"}},
                "description": {"type": "string"},
                "apply_steps": {"type": "array", "items": {"type": "string"}},
                "signals": {"type": "array", "items": {"type": "string"}},
                "intensity_levels": {"type": "object", "properties": {"low": {"type": "string"}, "med": {"type": "string"}, "high": {"type": "string"}}},
                "metrics": {"type": "object", "properties": {
                    "dialogue_ratio_range": {"type": "array", "items": {"type": "number"}},
                    "punctuation_caps": {"type": "integer"},
                    "metaphor_density": {"type": "number"},
                }},
                "do_dont": {"type": "object", "properties": {"do": {"type": "array", "items": {"type": "string"}}, "dont": {"type": "array", "items": {"type": "string"}}}},
                "examples": {"type": "array", "items": {"type": "string"}},
            }},
        },
    },
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
