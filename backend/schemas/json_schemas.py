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
                    "gender": {"type": "string", "maxLength": 200},
                    "pronouns": {"type": "string", "maxLength": 200},
                    "address_notes": {"type": "string", "maxLength": 2000},
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
                            "properties": {"target": {"type": "string"}, "type": {"type": "string"}, "address_as": {"type": "string", "maxLength": 200}},
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
                    "age": {"type": "integer", "minimum": 0},
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
    "story": {
        "type": "object", "required": ["id", "type", "title", "payload"],
        "properties": {
            "id": {"type": "string"},
            "type": {"const": "story"},
            "title": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "links": {"type": "array", "items": {"type": "string"}},
            "payload": {
                "type": "object",
                "properties": {
                    "logline": {"type": "string"},
                    "theme": {"type": "string"},
                    "genre": {"type": "string"},
                    "keywords": {"type": "array", "items": {"type": "string"}},
                    "target_reader": {"type": "string"},
                    "platform_style": {"type": "string"},
                    "worldview": {"type": "string"},
                    "main_conflict": {"type": "string"},
                    "banned_items": {"type": "array", "items": {"type": "string"}},
                    "important_scenes": {"type": "array", "items": {"type": "object"}},
                    "stages": {"type": "array", "items": {"type": "object"}},
                    "open_line": {"type": "array", "items": {"type": "object"}},
                    "hidden_line": {"type": "array", "items": {"type": "object"}},
                    "foreshadowings": {"type": "array", "items": {"type": "object"}},
                    "chapter_plan": {"type": "array", "items": {"type": "object"}},
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
    "tool_skill": {
        "type": "object",
        "required": ["id", "type", "title", "payload"],
        "properties": {
            "id": {"type": "string"},
            "type": {"const": "tool_skill"},
            "title": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "links": {"type": "array", "items": {"type": "string"}},
            "payload": {"type": "object", "properties": {
                "name": {"type": "string"},
                "category": {"type": "string", "enum": ["checker", "generator", "research", "tracker", "memory"]},
                "description": {"type": "string"},
                "input_types": {"type": "array", "items": {"type": "string"}},
                "output_type": {"type": "string"},
                "agent_role": {"type": "string", "enum": ["reviewer", "writer", "proofreader", "researcher", "system"]},
                "evidence_required": {"type": "boolean", "default": True},
                "auto_apply_allowed": {"type": "boolean", "default": False},
                "review_policy": {"type": "string"},
                "check_rules": {"type": "array", "items": {"type": "string"}},
                "proposal_fields": {"type": "array", "items": {"type": "string"}},
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

VOLUME_SCHEMA = {
    "type": "object",
    "required": ["id", "title"],
    "properties": {
        "id": {"type": "string"},
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "order_index": {"type": "integer", "minimum": 0},
        "chapter_ids": {"type": "array", "items": {"type": "string"}},
    },
}


COMMON_CARD_OPTIONAL_PROPERTIES = {
    "stars": {"type": "integer", "minimum": 0, "maximum": 5, "description": "Optional card star rating used for retrieval weighting."},
    "importance": {"type": "integer", "minimum": 1, "maximum": 5, "description": "Optional card importance used for retrieval weighting (default neutral=3)."},
}

# Optional author-facing fields; existing cards and their saved keys stay valid.
CARD_TYPE_SCHEMAS['world']['properties']['payload']['properties'] = {
    'era': {'type': 'string'},
    'setting': {'type': 'string'},
    'rules': {'type': 'array', 'items': {'type': 'string'}},
    'locations': {'type': 'array', 'items': {'type': 'string'}},
    'factions': {'type': 'array', 'items': {'type': 'string'}},
    'entry_type': {'type': 'string'},
    'direction': {'type': 'string', 'enum': ['geography', 'biology', 'physics_magic', 'metaphysics', 'technology', 'culture']},
    'parent_id': {'type': 'string'},
    'summary': {'type': 'string'}, 'content': {'type': 'string'},
    'boundaries': {'type': 'string'}, 'causes': {'type': 'string'}, 'consequences': {'type': 'string'},
    'core': {'type': 'boolean'},
    'creation_status': {'type': 'string', 'enum': ['new', 'draft', 'complete']},
    'setting_status': {'type': 'string', 'enum': ['unset', 'not_applicable', 'set']},
    'canon_status': {'type': 'string', 'enum': ['canon', 'hypothesis', 'inspiration']},
    'domain_status': {'type': 'object', 'properties': {key: {'type': 'string', 'enum': ['unset', 'not_applicable', 'set']} for key in ['geography', 'biology', 'physics_magic', 'metaphysics', 'technology', 'culture']}},
    'relationships': {'type': 'array', 'items': {'type': 'object', 'properties': {'target': {'type': 'string'}, 'type': {'type': 'string'}, 'chapter': {'type': 'string'}}}},
    'extra_context': {'type': 'object', 'properties': {
        'address_rules': {'type': 'string', 'maxLength': 2000},
        'world_base': {'type': 'object', 'properties': {
            'reference': {'type': 'string', 'maxLength': 200},
            'base_year': {'type': 'integer'}, 'offset_years': {'type': 'integer'},
            'changes': {'type': 'string', 'maxLength': 4000},
            'history': {'type': 'string', 'maxLength': 4000},
        }},
        'oc_notes': {'type': 'string'},
        'races': {'type': 'array', 'items': {'type': 'string'}},
        'genders': {'type': 'array', 'items': {'type': 'string'}},
        'levels': {'type': 'array', 'items': {'type': 'string'}},
        'map_url': {'type': 'string'},
    }},
}
CARD_TYPE_SCHEMAS['style']['properties']['payload']['properties'].update({
    'tone': {'type': 'string'},
    'rules': {'type': 'array', 'items': {'type': 'string'}},
    'style_guide': {'type': 'object', 'properties': {
        'sentence_length': {'type': 'string'}, 'dialogue_ratio': {'type': 'string'},
        'punctuation': {'type': 'string'},
    }},
})

for _kind in ['story', 'outline']:
    CARD_TYPE_SCHEMAS[_kind]['properties']['payload']['properties'].setdefault('important_scenes', {'type': 'array', 'items': {'type': 'object'}})['items']['properties'] = {
        'causal_scene_ids': {'type': 'array', 'items': {'type': 'string'}},
        'relationship_changes': {'type': 'array', 'items': {'type': 'object', 'properties': {
            'id': {'type': 'string'}, 'source_id': {'type': 'string'}, 'target_id': {'type': 'string'},
            'relation': {'type': 'string', 'maxLength': 500}, 'notes': {'type': 'string', 'maxLength': 2000},
        }}},
    }
CARD_TYPE_SCHEMAS['outline']['properties']['payload']['properties']['character_storylines'] = {
    'type': 'array', 'items': {'type': 'object', 'properties': {'emotion': {'type': 'string', 'maxLength': 2000}}},
}
CARD_TYPE_SCHEMAS['story']['properties']['payload']['properties']['foreshadowings']['items']['properties'] = {
    key: {'type': 'object', 'required': ['owner_card_id', 'scene_id'], 'properties': {'owner_card_id': {'type': 'string'}, 'scene_id': {'type': 'string'}}}
    for key in ['first_event_ref', 'payoff_event_ref']
}

for _schema in CARD_TYPE_SCHEMAS.values():
    props = _schema.setdefault("properties", {})
    for _k, _v in COMMON_CARD_OPTIONAL_PROPERTIES.items():
        props.setdefault(_k, _v)

for _kind in ['character', 'world', 'style', 'story', 'outline']:
    if _kind in CARD_TYPE_SCHEMAS:
        CARD_TYPE_SCHEMAS[_kind]['properties']['payload'].setdefault('properties', {})['writing_references'] = {'type': 'array', 'items': {'type': 'string'}}

CARD_TYPE_SCHEMAS['character']['properties']['payload']['properties']['reference_image'] = {'type': 'object', 'properties': {
    'asset_id': {'type': 'string'}, 'sha256': {'type': 'string'}, 'mime_type': {'type': 'string'},
    'filename': {'type': 'string'}, 'url': {'type': 'string'},
}}

# Time is author supplied; chapter order is never an age or branch clock.
EVENT_REF_SCHEMA = {'type': 'object', 'required': ['owner_card_id', 'scene_id'], 'properties': {
    'owner_card_id': {'type': 'string'}, 'scene_id': {'type': 'string'},
}}
STORY_TIME_SCHEMA = {'type': 'object', 'properties': {
    'year': {'type': 'integer'}, 'date': {'type': 'string'}, 'elapsed_years': {'type': 'number'},
    'event_ref': EVENT_REF_SCHEMA, 'position': {'type': 'string', 'enum': ['before', 'immediate_after', 'phase']}, 'phase': {'type': 'string'},
}}
WORLD_CONTEXT_SCHEMA = {'type': 'object', 'properties': {
    'world_id': {'type': 'string'}, 'branch_id': {'type': 'string'}, 'time': STORY_TIME_SCHEMA,
    'base_setting_ids': {'type': 'array', 'items': {'type': 'string'}}, 'local_adjustments': {'type': 'string'},
}}
for _kind in ['story', 'outline', 'character', 'world']:
    CARD_TYPE_SCHEMAS[_kind]['properties']['payload']['properties']['world_context'] = WORLD_CONTEXT_SCHEMA
for _kind in ['story', 'outline']:
    CARD_TYPE_SCHEMAS[_kind]['properties']['payload']['properties']['important_scenes']['items']['properties'].update({
        'world_context': WORLD_CONTEXT_SCHEMA, 'canonical_event_ref': EVENT_REF_SCHEMA, 'pov': {'type': 'string'}, 'pov_character_id': {'type': 'string'},
        'causal_event_refs': {'type': 'array', 'items': EVENT_REF_SCHEMA},
    })
CARD_TYPE_SCHEMAS['character']['properties']['payload']['required'] = ['name', 'identity']
CARD_TYPE_SCHEMAS['character']['properties']['payload']['properties'].update({
    'detail_level': {'type': 'string', 'enum': ['brief', 'detailed']}, 'initial_pov': {'type': 'string'},
    'initial_age': {'type': 'number', 'minimum': 0}, 'initial_age_time': STORY_TIME_SCHEMA, 'birth_date': {'type': 'string'},
})
CARD_TYPE_SCHEMAS['world']['properties']['payload']['properties']['branches'] = {'type': 'array', 'items': {'type': 'object', 'properties': {
    'id': {'type': 'string'}, 'label': {'type': 'string'}, 'parent_branch_id': {'type': ['string', 'null']}, 'fork_event_ref': EVENT_REF_SCHEMA,
}}}
CARD_TYPE_SCHEMAS['style']['properties']['payload']['properties']['style_guide']['properties']['pov'] = {'type': 'string'}
