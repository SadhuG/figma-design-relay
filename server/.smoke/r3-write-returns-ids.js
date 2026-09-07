const frame = figma.createFrame();
frame.name = "run_script smoke test";
frame.resize(200, 120);
frame.x = 0;
frame.y = 0;
figma.currentPage.appendChild(frame);
return { createdNodeIds: [frame.id] };
