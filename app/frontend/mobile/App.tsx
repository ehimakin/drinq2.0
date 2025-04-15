import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Game from './waitinggames/Pintless/Game';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Pintless">
        <Stack.Screen name="Pintless" component={Game} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
