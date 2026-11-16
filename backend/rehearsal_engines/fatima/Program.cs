using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using AutobiographicMemory;
using EmotionalAppraisal;
using EmotionalAppraisal.DTOs;
using GAIPS.Rage;
using KnowledgeBase;
using WellFormedNames;

// Text and character names stay in Novix. The toolkit receives the witnessed
// event and the observer's appraisal of its desirability for their own goal.
using var input = JsonDocument.Parse(Console.In.ReadToEnd());
var desirability = input.RootElement.GetProperty("desirability").GetInt32();
if (desirability < -10 || desirability > 10) return 2;
var observer = Name.BuildName("Observer");
var occurrence = Name.BuildName("Event(Action-End, Speaker, Initiate, Observer)");
var appraisal = EmotionalAppraisalAsset.CreateInstance(new AssetStorage());
appraisal.AddOrUpdateAppraisalRule(new AppraisalRuleDTO {
    EventMatchingTemplate = occurrence,
    AppraisalVariables = new AppraisalVariables(new List<AppraisalVariableDTO> {
        new AppraisalVariableDTO { Name = "Desirability", Value = Name.BuildName(desirability) }
    })
});
var state = new ConcreteEmotionalState();
appraisal.AppraiseEvents(new[] { occurrence }, observer, state, new AM(), new KB(observer), null);
Console.Write(JsonSerializer.Serialize(new {
    mood = state.Mood,
    emotions = state.GetAllEmotions().Select(e => new { type = e.EmotionType, intensity = e.Intensity })
}));
return 0;
