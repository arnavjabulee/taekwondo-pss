/* Use input events so the embedded browser commits edits before Save is clicked. */
e('input', {
  directives: [
    {
      name: 'model',
      rawName: 'v-model',
      value: t.gameinfo.game_name,
      expression: 'gameinfo.game_name'
    }
  ],
  staticClass: 'form-control',
  attrs: {
    id: 'uobtkd-team-name',
    type: 'text',
    autocomplete: 'organization'
  },
  domProps: { value: t.gameinfo.game_name },
  on: {
    input: function (event) {
      if (!event.target.composing) t.$set(t.gameinfo, 'game_name', event.target.value);
    }
  }
});
