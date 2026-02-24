export type Runtime = {
	navigator: RuntimeNavigator;
};

export type RuntimeNavigator = {
	infoPanel: NavigatorInfoPanel;
};

export type NavigatorInfoPanel = {
	properties: NavigatorInfoPanelProperty[];
};

export type NavigatorInfoPanelProperty = {
	propName: string;
	title: string;
	value: string;
	tooltip: string;
};
