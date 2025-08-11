const target = actor || canvas.tokens.controlled[0].actor || game.user.character;

if (target !== null) {
    let tempo = target.system.conditions.tempoInsane.value;
    let text = "";

    if (!!tempo == false) {
        tempo = true;
        text = "を起こした。";
    } else {
        tempo = false;
        text = "が治った。";
    }

    target.toggleCondition("tempoInsane")

    const content = `<p>${target.name}は狂気の発作${text}</p>`;

    let chatData = {
        user: game.user._id,
        speaker: ChatMessage.getSpeaker(),
        content: content
    };

    ChatMessage.create(chatData, {});
} else {
    ui.notifications.warn("トークンを選択してください");
}